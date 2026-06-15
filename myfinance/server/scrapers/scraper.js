/**
 * Bank scraping module — wraps the israeli-bank-scrapers library.
 *
 * Flow:
 *   1. Decrypt the account's stored credentials.
 *   2. Map our internal source key to the library's CompanyTypes id.
 *   3. Run the scraper (headless browser) for the right date range.
 *   4. Save the returned transactions with deduplication.
 *
 * Credentials live only in memory during the scrape — never logged, never written.
 */

import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { decrypt, encrypt } from '../crypto/encryption.js'
import { getDb, backupDatabase, logActivity } from '../db/database.js'
import { saveAccountTransactions } from '../db/save-transactions.js'
import { upsertBalance } from '../db/balances.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LOGS_DIR = path.join(__dirname, '..', '..', 'logs')

// israeli-bank-scrapers is a CommonJS package — load it via require
const require = createRequire(import.meta.url)
const { createScraper, CompanyTypes } = require('israeli-bank-scrapers')

/**
 * Map our internal source keys to the library's company identifiers.
 * (The library uses different names than our UI keys.)
 */
const SOURCE_TO_COMPANY = {
  hapoalim: CompanyTypes.hapoalim,
  discount: CompanyTypes.discount,
  fibi:     CompanyTypes.beinleumi,
  mizrahi:  CompanyTypes.mizrahi,
  onezero:  CompanyTypes.oneZero,
  isracard: CompanyTypes.isracard,
  cal:      CompanyTypes.visaCal,
  max:      CompanyTypes.max,
}

/**
 * Decide the start date for scraping.
 * First run (account never scraped): go back 6 months.
 * Subsequent runs: go back 45 days (with overlap; dedup handles the rest).
 */
function getStartDate(account) {
  const now = new Date()
  const monthsBack = account.last_scraped ? 0 : 6
  const daysBack   = account.last_scraped ? 45 : 0
  const d = new Date(now)
  d.setMonth(d.getMonth() - monthsBack)
  d.setDate(d.getDate() - daysBack)
  return d
}

/**
 * Scrape a single account and save its transactions.
 *
 * @param {object} account - account row (id, name, source, owner, credentials, last_scraped)
 * @returns {object} result { success, accounts, stats, errorType, errorMessage }
 */
export async function scrapeAccount(account) {
  const companyId = SOURCE_TO_COMPANY[account.source]
  if (!companyId) {
    return { success: false, errorType: 'CONFIG', errorMessage: `Unknown source: ${account.source}` }
  }

  // Decrypt credentials (in memory only)
  let credentials
  try {
    credentials = JSON.parse(decrypt(account.credentials))
  } catch {
    return { success: false, errorType: 'DECRYPT', errorMessage: 'Could not decrypt credentials' }
  }

  const startDate = getStartDate(account)
  logActivity('scrape_started', account.source, `account ${account.id}`)

  const options = {
    companyId,
    startDate,
    combineInstallments: false,
    // Show the real browser window by default. Israeli bank sites (esp. Discount)
    // often behave differently or block headless browsers, returning UNKNOWN_ERROR.
    // Set SHOW_BROWSER=false in the environment to run headless once it's stable.
    showBrowser: process.env.SHOW_BROWSER !== 'false',
    verbose: true,            // extra library logging to the server console
    // Generous timeout: some banks (e.g. Hapoalim) require an SMS/OTP code that the
    // user types manually in the visible browser — give them time before aborting.
    timeout: 360000,          // 6 minutes per scrape
    defaultTimeout: 90000,
    // On failure, save a screenshot of the page so we can see what went wrong
    // (wrong page, OTP prompt, error message, etc.).
    // PRIVACY: this image is of the live bank page and may show the username/account
    // on screen. It is written ONLY to the git-ignored logs/ folder. Do not commit
    // logs/, and clear these screenshots when you no longer need them for debugging.
    storeFailureScreenShotPath: path.join(LOGS_DIR, `scrape-failure-${account.source}.png`),
  }

  let result
  try {
    const scraper = createScraper(options)
    result = await scraper.scrape(credentials)
  } catch (err) {
    // Log the technical error to the server console for debugging (no credentials here)
    console.error(`[scrape] ${account.source} exception:`, err.message)
    logActivity('scrape_error', account.source, 'exception during scrape')
    return { success: false, errorType: 'EXCEPTION', errorMessage: err.message }
  } finally {
    // Best-effort: clear the decrypted credentials reference
    credentials = null
  }

  if (!result.success) {
    console.error(`[scrape] ${account.source} failed:`, result.errorType, '-', result.errorMessage)
    logActivity('scrape_error', account.source, result.errorType || 'unknown')
    return result
  }

  // Back up the DB before writing any imported data
  backupDatabase()

  // Save every account returned. One bank/card login can return several
  // accounts or cards — we save them all and report a per-account breakdown.
  const stats = { inserted: 0, updated: 0, skipped: 0, removedPending: 0 }
  const breakdown = []
  const nowISO = new Date().toISOString()
  const db = getDb()
  for (const scrapedAccount of result.accounts || []) {
    const s = saveAccountTransactions(account, scrapedAccount)
    stats.inserted += s.inserted
    stats.updated  += s.updated
    stats.skipped  += s.skipped
    stats.removedPending += s.removedPending || 0
    // Store the balance "as of update day" for this account/card. Banks provide a
    // real balance; credit cards typically return undefined → stored as null.
    upsertBalance(db, account.id, scrapedAccount.accountNumber,
      scrapedAccount.balance ?? null, nowISO)
    breakdown.push({
      accountNumber: scrapedAccount.accountNumber,
      total: (scrapedAccount.txns || []).length,
      balance: scrapedAccount.balance ?? null,
      ...s,
    })
  }
  stats.accountsCount = breakdown.length
  stats.breakdown = breakdown

  // Mark this account as successfully scraped now. Store local computer time
  // (not UTC) so the "last synced" label matches the clock on this machine.
  getDb().prepare(
    `UPDATE accounts SET last_scraped = datetime('now','localtime'), updated_at = datetime('now','localtime') WHERE id = ?`
  ).run(account.id)

  logActivity('scrape_success', account.source,
    `inserted ${stats.inserted}, updated ${stats.updated}, skipped ${stats.skipped}, removedPending ${stats.removedPending}`)

  return { success: true, accounts: result.accounts, stats }
}

// --- OneZero OTP linking ---------------------------------------------------
// OneZero logs in with a one-time SMS code. The first time, we trigger an SMS,
// the user types the code, and the library hands back a long-term token
// (`otpLongTermToken`) which we store so future scrapes skip the SMS entirely.
//
// The OTP context lives on the scraper instance between triggering the SMS and
// verifying the code, so we keep that one instance in memory across the two
// calls. The flow is plain HTTP (no browser), so this is cheap.

const onezeroOtpSessions = new Map()           // accountId -> { scraper, createdAt }
const OTP_SESSION_TTL_MS = 5 * 60 * 1000

// OneZero sits behind Cloudflare, which blocks Node's TLS fingerprint and returns
// an HTML challenge page instead of JSON — the library then fails parsing it with
// "Unexpected token '<'". Translate that into a clear message instead of leaking
// the parser error to the user.
function friendlyOneZeroError(msg) {
  if (/<!DOCTYPE|Unexpected token '<'|not valid JSON/i.test(msg || '')) {
    return 'OneZero חסום כרגע על ידי Cloudflare ולא ניתן להתחבר אוטומטית מהמחשב. נסה שוב מאוחר יותר, או הזן את התנועות ידנית.'
  }
  return msg
}

function pruneOtpSessions() {
  const now = Date.now()
  for (const [id, s] of onezeroOtpSessions) {
    if (now - s.createdAt > OTP_SESSION_TTL_MS) onezeroOtpSessions.delete(id)
  }
}

/**
 * Step 1: trigger a OneZero SMS code to the account's stored phone number.
 * Keeps the scraper instance (holding the OTP context) for the verify step.
 * @returns {Promise<{success:boolean, errorMessage?:string}>}
 */
export async function oneZeroStartOtp(account) {
  if (account.source !== 'onezero') return { success: false, errorMessage: 'Not a OneZero account' }
  let credentials
  try { credentials = JSON.parse(decrypt(account.credentials)) }
  catch { return { success: false, errorMessage: 'Could not decrypt credentials' } }

  const phoneNumber = String(credentials.phoneNumber || '').trim()
  credentials = null
  if (!phoneNumber) {
    return { success: false, errorMessage: 'מספר טלפון חסר — ערוך את החשבון והוסף טלפון בפורמט בינלאומי (לדוגמה +97250...)' }
  }
  if (!phoneNumber.startsWith('+')) {
    return { success: false, errorMessage: 'מספר הטלפון חייב להתחיל ב-+ וקידומת מדינה (לדוגמה +97250...)' }
  }

  pruneOtpSessions()
  try {
    const scraper = createScraper({ companyId: CompanyTypes.oneZero, startDate: new Date(), showBrowser: false, verbose: false })
    const r = await scraper.triggerTwoFactorAuth(phoneNumber)
    if (!r || r.success === false) {
      return { success: false, errorMessage: friendlyOneZeroError(r?.errorMessage) || 'שליחת קוד ה-SMS נכשלה' }
    }
    onezeroOtpSessions.set(account.id, { scraper, createdAt: Date.now() })
    return { success: true }
  } catch (err) {
    console.error('[onezero] triggerTwoFactorAuth failed:', err.message)
    return { success: false, errorMessage: friendlyOneZeroError(err.message) }
  }
}

/**
 * Step 2: verify the SMS code, obtain the long-term token, and store it in the
 * account's credentials so future scrapes need no OTP.
 * @returns {Promise<{success:boolean, errorMessage?:string}>}
 */
export async function oneZeroVerifyOtp(account, otpCode) {
  const session = onezeroOtpSessions.get(account.id)
  if (!session) return { success: false, errorMessage: 'תוקף הבקשה פג — התחל מחדש את החיבור ב-SMS' }
  const code = String(otpCode || '').trim()
  if (!code) return { success: false, errorMessage: 'הזן את קוד ה-SMS' }

  try {
    const r = await session.scraper.getLongTermTwoFactorToken(code)
    if (!r || r.success === false || !r.longTermTwoFactorAuthToken) {
      return { success: false, errorMessage: friendlyOneZeroError(r?.errorMessage) || 'קוד שגוי או שפג תוקפו' }
    }
    // Merge the long-term token into the stored credentials (re-encrypt).
    let credentials = JSON.parse(decrypt(account.credentials))
    credentials.otpLongTermToken = r.longTermTwoFactorAuthToken
    getDb().prepare(`UPDATE accounts SET credentials = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(encrypt(JSON.stringify(credentials)), account.id)
    credentials = null
    onezeroOtpSessions.delete(account.id)
    logActivity('onezero_linked', account.source, `account ${account.id}`)
    return { success: true }
  } catch (err) {
    console.error('[onezero] getLongTermTwoFactorToken failed:', err.message)
    return { success: false, errorMessage: friendlyOneZeroError(err.message) }
  }
}
