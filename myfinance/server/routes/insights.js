/**
 * Insights API — the monthly-level analysis behind the "תובנות" page.
 *
 *   GET /api/insights?months=6        last 6 complete months (default)
 *   GET /api/insights?months=all      every complete month with data
 *
 * The current (partial) month is never included. See db/insights.js for the
 * seven sections and their conventions.
 */

import { Router } from 'express'
import { getDb } from '../db/database.js'
import { isUnlocked } from '../crypto/encryption.js'
import { computeInsights } from '../db/insights.js'

const router = Router()

router.use((req, res, next) => {
  if (!isUnlocked()) return res.status(401).json({ error: 'App is locked' })
  next()
})

router.get('/', (req, res) => {
  const raw = String(req.query.months || '6')
  let monthsBack = 6
  if (raw === 'all') monthsBack = 'all'
  else {
    const n = Number(raw)
    if (Number.isInteger(n) && n >= 2 && n <= 36) monthsBack = n
  }
  res.json(computeInsights(getDb(), { monthsBack }))
})

export default router
