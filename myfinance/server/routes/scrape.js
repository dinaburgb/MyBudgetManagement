/**
 * Scraping API — run scrapers and report status.
 */

import { Router } from 'express'
import { getDb } from '../db/database.js'
import { isUnlocked } from '../crypto/encryption.js'
import { scrapeAccount, oneZeroStartOtp, oneZeroVerifyOtp } from '../scrapers/scraper.js'

const router = Router()

router.use((req, res, next) => {
  if (!isUnlocked()) return res.status(401).json({ error: 'App is locked' })
  next()
})

/** GET /api/scrape/status — last scrape info per account */
router.get('/status', (req, res) => {
  const db = getDb()
  const accounts = db.prepare(
    `SELECT id, name, source, owner, last_scraped, enabled FROM accounts`
  ).all()
  res.json(accounts)
})

/**
 * POST /api/scrape/account/:id — scrape a single account now.
 * Returns the result with stats (inserted/updated/skipped).
 */
router.post('/account/:id', async (req, res) => {
  const db = getDb()
  const account = db.prepare(`SELECT * FROM accounts WHERE id = ?`).get(req.params.id)
  if (!account) return res.status(404).json({ error: 'Account not found' })

  const result = await scrapeAccount(account)

  if (!result.success) {
    // Human-friendly error messages
    const messages = {
      INVALID_PASSWORD: 'Wrong username or password for this account',
      CHANGE_PASSWORD:  'The bank requires you to change your password — do it on the bank website first',
      ACCOUNT_BLOCKED:  'This account is blocked by the bank',
      DECRYPT:          'Could not read saved credentials',
      CONFIG:           'This bank is not configured correctly',
      TIMEOUT:          'The bank website took too long to respond — try again',
      GENERIC:          'The bank website could not be reached',
    }
    const friendly = messages[result.errorType] || result.errorMessage || 'Scraping failed'
    return res.status(502).json({ error: friendly, errorType: result.errorType })
  }

  res.json({ message: 'Scrape complete', stats: result.stats })
})

/**
 * POST /api/scrape/onezero/start — send a OneZero SMS code to the account's phone.
 * Body: { accountId }.
 */
router.post('/onezero/start', async (req, res) => {
  const account = getDb().prepare(`SELECT * FROM accounts WHERE id = ?`).get(req.body.accountId)
  if (!account) return res.status(404).json({ error: 'Account not found' })
  const r = await oneZeroStartOtp(account)
  if (!r.success) return res.status(400).json({ error: r.errorMessage })
  res.json({ status: 'otp_sent' })
})

/**
 * POST /api/scrape/onezero/verify — verify the SMS code and store the long-term
 * token so future scrapes need no OTP. Body: { accountId, code }.
 */
router.post('/onezero/verify', async (req, res) => {
  const account = getDb().prepare(`SELECT * FROM accounts WHERE id = ?`).get(req.body.accountId)
  if (!account) return res.status(404).json({ error: 'Account not found' })
  const r = await oneZeroVerifyOtp(account, req.body.code)
  if (!r.success) return res.status(400).json({ error: r.errorMessage })
  res.json({ status: 'linked' })
})

/**
 * POST /api/scrape/all — scrape every enabled account.
 * Continues even if one account fails (per project rules).
 */
router.post('/all', async (req, res) => {
  const db = getDb()
  const accounts = db.prepare(`SELECT * FROM accounts WHERE enabled = 1`).all()

  const results = []
  for (const account of accounts) {
    const result = await scrapeAccount(account)
    results.push({
      id: account.id,
      name: account.name,
      success: result.success,
      stats: result.stats || null,
      errorType: result.errorType || null,
    })
  }

  res.json({ results })
})

export default router
