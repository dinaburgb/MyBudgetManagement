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
import { decrypt } from '../crypto/encryption.js'
import { getDb, backupDatabase, logActivity } from '../db/database.js'
import { saveAccountTransactions } from '../db/save-transactions.js'

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
    showBrowser: false,       // headless — no window pops up
    timeout: 120000,          // 2 minutes per scrape
    defaultTimeout: 60000,
  }

  let result
  try {
    const scraper = createScraper(options)
    result = await scraper.scrape(credentials)
  } catch (err) {
    logActivity('scrape_error', account.source, 'exception during scrape')
    return { success: false, errorType: 'EXCEPTION', errorMessage: err.message }
  } finally {
    // Best-effort: clear the decrypted credentials reference
    credentials = null
  }

  if (!result.success) {
    logActivity('scrape_error', account.source, result.errorType || 'unknown')
    return result
  }

  // Back up the DB before writing any imported data
  backupDatabase()

  // Save every account returned (a card login can return several cards)
  const stats = { inserted: 0, updated: 0, skipped: 0 }
  for (const scrapedAccount of result.accounts || []) {
    const s = saveAccountTransactions(account, scrapedAccount)
    stats.inserted += s.inserted
    stats.updated  += s.updated
    stats.skipped  += s.skipped
  }

  // Mark this account as successfully scraped now
  getDb().prepare(
    `UPDATE accounts SET last_scraped = datetime('now'), updated_at = datetime('now') WHERE id = ?`
  ).run(account.id)

  logActivity('scrape_success', account.source,
    `inserted ${stats.inserted}, updated ${stats.updated}, skipped ${stats.skipped}`)

  return { success: true, accounts: result.accounts, stats }
}
