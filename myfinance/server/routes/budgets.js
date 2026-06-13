/**
 * Budgets API — monthly spending limits per category.
 *
 *   GET    /api/budgets/overview?month=YYYY-MM   per-category limit, spent, remaining
 *   PUT    /api/budgets                          set a limit { category, amount, month? }
 *   DELETE /api/budgets                          remove a limit { category, month? }
 */

import { Router } from 'express'
import { getDb } from '../db/database.js'
import { isUnlocked } from '../crypto/encryption.js'
import { computeBudgetOverview, setBudget, deleteBudget, isValidMonth, budgetCategoryTransactions } from '../db/budgets.js'

const router = Router()

router.use((req, res, next) => {
  if (!isUnlocked()) return res.status(401).json({ error: 'App is locked' })
  next()
})

/** Current month as 'YYYY-MM', in LOCAL time (toISOString would use UTC and flip
 *  the month near local midnight). */
function currentMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** GET /api/budgets/overview — all categories with limit/spent/remaining for a month */
router.get('/overview', (req, res) => {
  const month = isValidMonth(req.query.month) ? req.query.month : currentMonth()
  const rows = computeBudgetOverview(getDb(), month)
  res.json({ month, rows })
})

/** GET /api/budgets/transactions?category=..&month=YYYY-MM — drill-down rows */
router.get('/transactions', (req, res) => {
  const month = isValidMonth(req.query.month) ? req.query.month : currentMonth()
  const category = req.query.category
  if (!category) return res.status(400).json({ error: 'category is required' })
  res.json({ category, month, rows: budgetCategoryTransactions(getDb(), category, month) })
})

/** PUT /api/budgets — set or update a limit */
router.put('/', (req, res) => {
  const { category, amount, month = '' } = req.body
  const amt = Number(amount)
  if (!category || amount == null || !Number.isFinite(amt) || amt < 0) {
    return res.status(400).json({ error: 'category and a non-negative numeric amount are required' })
  }
  if (month !== '' && !isValidMonth(month)) {
    return res.status(400).json({ error: 'month must be empty or YYYY-MM' })
  }
  setBudget(getDb(), category, Number(amount), month)
  res.json({ message: 'Budget saved' })
})

/** DELETE /api/budgets — remove a limit */
router.delete('/', (req, res) => {
  const { category, month = '' } = req.body
  if (!category) return res.status(400).json({ error: 'category is required' })
  deleteBudget(getDb(), category, month)
  res.json({ message: 'Budget removed' })
})

export default router
