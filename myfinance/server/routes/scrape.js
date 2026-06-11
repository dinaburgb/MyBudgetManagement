/**
 * Scraping API — placeholder for Phase 2.
 * Returns the list of accounts and their last-scraped status.
 */

import { Router } from 'express'
import { getDb } from '../db/database.js'
import { isUnlocked } from '../crypto/encryption.js'

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

/** POST /api/scrape/start — start a scraping job (Phase 2 implementation) */
router.post('/start', (req, res) => {
  res.json({ message: 'Scraping will be implemented in Phase 2' })
})

export default router
