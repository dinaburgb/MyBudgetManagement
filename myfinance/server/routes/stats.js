/**
 * Stats API — aggregated numbers for the dashboard charts.
 * Everything counts only accounts that are included in totals.
 *
 *   GET /api/stats/overview?months=6
 *     {
 *       months: ['2026-01', ...],
 *       monthly:    [{ month, expenses, income }],
 *       byCategory: [{ category, expenses }],   // for the latest `months` window
 *       totals:     { expenses, income, balance }
 *     }
 */

import { Router } from 'express'
import { getDb } from '../db/database.js'
import { isUnlocked } from '../crypto/encryption.js'

const router = Router()

router.use((req, res, next) => {
  if (!isUnlocked()) return res.status(401).json({ error: 'App is locked' })
  next()
})

/** Build an array of the last N month keys, oldest first: ['2026-01', ...]. */
function lastMonths(n) {
  const out = []
  const d = new Date()
  d.setDate(1)
  for (let i = n - 1; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1)
    out.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

router.get('/overview', (req, res) => {
  const db = getDb()
  const n = Math.min(Math.max(Number(req.query.months) || 6, 1), 24)
  const months = lastMonths(n)
  const from = months[0] + '-01'

  // Monthly income / expense totals (included accounts only)
  const monthlyRows = db.prepare(`
    SELECT substr(t.date, 1, 7) AS month,
           SUM(CASE WHEN t.amount < 0 THEN -t.amount ELSE 0 END) AS expenses,
           SUM(CASE WHEN t.amount > 0 THEN  t.amount ELSE 0 END) AS income
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE a.include_in_totals = 1 AND t.date >= ?
    GROUP BY month
  `).all(from)
  const byMonth = new Map(monthlyRows.map(r => [r.month, r]))

  const monthly = months.map(month => ({
    month,
    expenses: byMonth.get(month)?.expenses || 0,
    income:   byMonth.get(month)?.income   || 0,
  }))

  // Expenses by category over the window
  const byCategory = db.prepare(`
    SELECT t.category AS category,
           SUM(CASE WHEN t.amount < 0 THEN -t.amount ELSE 0 END) AS expenses
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE a.include_in_totals = 1 AND t.date >= ?
    GROUP BY t.category
    HAVING expenses > 0
    ORDER BY expenses DESC
  `).all(from)

  const totals = monthly.reduce((acc, m) => {
    acc.expenses += m.expenses
    acc.income   += m.income
    return acc
  }, { expenses: 0, income: 0 })
  totals.balance = totals.income - totals.expenses

  res.json({ months, monthly, byCategory, totals })
})

export default router
