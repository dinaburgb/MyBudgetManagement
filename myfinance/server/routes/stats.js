/**
 * Stats API — aggregated numbers for the dashboard charts.
 *
 *   GET /api/stats/overview?months=2026-01,2026-02&accounts=1,3
 *     months   - comma-separated 'YYYY-MM' set (default: last 6 months)
 *     accounts - comma-separated account ids to include
 *                (default: all accounts flagged include_in_totals)
 *
 *   Response:
 *     {
 *       months:     ['2026-01', ...],          // the months actually used, sorted
 *       monthly:    [{ month, expenses, income }],
 *       byCategory: [{ category, expenses }],
 *       totals:     { expenses, income, balance },
 *       netBalance: number                      // sum of current balances, selected accounts
 *     }
 */

import { Router } from 'express'
import { getDb } from '../db/database.js'
import { isUnlocked } from '../crypto/encryption.js'
import { netBalance } from '../db/balances.js'

const router = Router()

router.use((req, res, next) => {
  if (!isUnlocked()) return res.status(401).json({ error: 'App is locked' })
  next()
})

const isMonth = m => /^\d{4}-(0[1-9]|1[0-2])$/.test(m)

/** Last N month keys, oldest first. */
function lastMonths(n) {
  const out = []
  const d = new Date()
  for (let i = n - 1; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1)
    out.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

router.get('/overview', (req, res) => {
  const db = getDb()

  // --- resolve selected months ---
  let months = String(req.query.months || '').split(',').map(s => s.trim()).filter(isMonth)
  if (months.length === 0) months = lastMonths(6)
  months = [...new Set(months)].sort()

  // --- resolve selected accounts ---
  let accountIds = String(req.query.accounts || '').split(',')
    .map(s => Number(s.trim())).filter(n => Number.isInteger(n) && n > 0)
  if (accountIds.length === 0) {
    accountIds = db.prepare(`SELECT id FROM accounts WHERE include_in_totals = 1`)
      .all().map(r => r.id)
  }

  // Nothing selected → empty result (avoid an empty IN () which is invalid SQL)
  if (accountIds.length === 0) {
    return res.json({
      months, monthly: months.map(month => ({ month, expenses: 0, income: 0 })),
      byCategory: [], totals: { expenses: 0, income: 0, balance: 0 }, netBalance: 0,
    })
  }

  const mPlaceholders = months.map(() => '?').join(',')
  const aPlaceholders = accountIds.map(() => '?').join(',')
  const params = [...months, ...accountIds]

  // Monthly income / expense totals
  const monthlyRows = db.prepare(`
    SELECT substr(date, 1, 7) AS month,
           SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END) AS expenses,
           SUM(CASE WHEN amount > 0 THEN  amount ELSE 0 END) AS income
    FROM transactions
    WHERE substr(date, 1, 7) IN (${mPlaceholders})
      AND account_id IN (${aPlaceholders})
    GROUP BY month
  `).all(...params)
  const byMonth = new Map(monthlyRows.map(r => [r.month, r]))
  const monthly = months.map(month => ({
    month,
    expenses: byMonth.get(month)?.expenses || 0,
    income:   byMonth.get(month)?.income   || 0,
  }))

  // Expenses by category over the selected months/accounts
  const byCategory = db.prepare(`
    SELECT category,
           SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END) AS expenses
    FROM transactions
    WHERE substr(date, 1, 7) IN (${mPlaceholders})
      AND account_id IN (${aPlaceholders})
    GROUP BY category
    HAVING expenses > 0
    ORDER BY expenses DESC
  `).all(...params)

  const totals = monthly.reduce((acc, m) => {
    acc.expenses += m.expenses
    acc.income   += m.income
    return acc
  }, { expenses: 0, income: 0 })
  totals.balance = totals.income - totals.expenses

  res.json({ months, monthly, byCategory, totals, netBalance: netBalance(db, accountIds) })
})

export default router
