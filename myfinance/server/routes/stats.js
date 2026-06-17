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
import { budgetSummaryForMonths } from '../db/budgets.js'
import { incomeCategoryNames, excludedCategoryNames } from '../db/categories.js'
import { notExcludedSql } from '../db/subaccounts.js'

// Sub-account exclusion fragment for the (un-aliased) transactions table.
const NOT_EXCLUDED = notExcludedSql('transactions.account_id', 'transactions.account_number')

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

/** Resolve months[] and accountIds[] from the query, applying defaults. */
function resolveSelection(db, req) {
  let months = String(req.query.months || '').split(',').map(s => s.trim()).filter(isMonth)
  if (months.length === 0) months = lastMonths(6)
  months = [...new Set(months)].sort()

  let accountIds = String(req.query.accounts || '').split(',')
    .map(s => Number(s.trim())).filter(n => Number.isInteger(n) && n > 0)
  if (accountIds.length === 0) {
    accountIds = db.prepare(`SELECT id FROM accounts WHERE include_in_totals = 1`).all().map(r => r.id)
  }
  return { months, accountIds }
}

/**
 * Build the category / budget / actual table for the Overview. Budget is the
 * effective limit summed over the selected months (null when never budgeted).
 * "Actual" is expenses for normal categories, but the income sum for categories
 * flagged as income — so an income category gets a row with its earnings, while
 * still being kept out of the expense pie. One row per category that has a
 * budget, some spending, or (for income categories) some income.
 */
function buildBudgetTable(db, months, expenseRows, incomeRows, incomeSet, excludedSet = new Set()) {
  const expense = new Map(expenseRows.map(c => [c.category, c.expenses]))
  const income  = new Map(incomeRows.map(c => [c.category, c.income]))
  const budget  = budgetSummaryForMonths(db, months)
  const cats = [...new Set([...expense.keys(), ...income.keys(), ...budget.keys()])]
    .filter(c => !excludedSet.has(c))   // excluded categories never appear in the table
  return cats.map(category => {
    const isIncome = incomeSet.has(category)
    const limit  = budget.has(category) ? budget.get(category) : null
    const actual = isIncome ? (income.get(category) || 0) : (expense.get(category) || 0)
    return {
      category,
      kind: isIncome ? 'income' : 'expense',
      budget: limit,
      actual,
      remaining: limit != null ? limit - actual : null,
    }
  }).sort((a, b) => b.actual - a.actual)
}

router.get('/overview', (req, res) => {
  const db = getDb()
  const { months, accountIds } = resolveSelection(db, req)

  // Nothing selected → empty result (avoid an empty IN () which is invalid SQL).
  // Budgets are account-agnostic, so still report them (with zero actuals).
  const incomeSet = new Set(incomeCategoryNames(db))
  const excludedSet = new Set(excludedCategoryNames(db))
  if (accountIds.length === 0) {
    return res.json({
      months, monthly: months.map(month => ({ month, expenses: 0, income: 0 })),
      byCategory: [], incomeByCategory: [], totals: { expenses: 0, income: 0, balance: 0 }, netBalance: 0,
      budgetTable: buildBudgetTable(db, months, [], [], incomeSet, excludedSet),
    })
  }

  const mPlaceholders = months.map(() => '?').join(',')
  const aPlaceholders = accountIds.map(() => '?').join(',')
  // Excluded categories (e.g. credit-card repayment) are ignored in every total.
  const excludedCats = [...excludedSet]
  const catClause = excludedCats.length ? `AND category NOT IN (${excludedCats.map(() => '?').join(',')})` : ''
  const params = [...months, ...accountIds, ...excludedCats]

  // Monthly income / expense totals
  const monthlyRows = db.prepare(`
    SELECT substr(date, 1, 7) AS month,
           SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END) AS expenses,
           SUM(CASE WHEN amount > 0 THEN  amount ELSE 0 END) AS income
    FROM transactions
    WHERE substr(date, 1, 7) IN (${mPlaceholders})
      AND account_id IN (${aPlaceholders})
      AND ${NOT_EXCLUDED}
      AND is_transfer = 0
      ${catClause}
    GROUP BY month
  `).all(...params)
  const byMonth = new Map(monthlyRows.map(r => [r.month, r]))
  const monthly = months.map(month => ({
    month,
    expenses: byMonth.get(month)?.expenses || 0,
    income:   byMonth.get(month)?.income   || 0,
  }))

  // Expenses by category over the selected months/accounts
  const expenseByCategory = db.prepare(`
    SELECT category,
           SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END) AS expenses
    FROM transactions
    WHERE substr(date, 1, 7) IN (${mPlaceholders})
      AND account_id IN (${aPlaceholders})
      AND ${NOT_EXCLUDED}
      AND is_transfer = 0
      ${catClause}
    GROUP BY category
    HAVING expenses > 0
    ORDER BY expenses DESC
  `).all(...params)

  // Income per income-flagged category (for the budget table's "actual").
  let incomeByCategory = []
  const incomeCats = [...incomeSet]
  if (incomeCats.length) {
    const iP = incomeCats.map(() => '?').join(',')
    incomeByCategory = db.prepare(`
      SELECT category, SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS income
      FROM transactions
      WHERE substr(date, 1, 7) IN (${mPlaceholders})
        AND account_id IN (${aPlaceholders})
        AND ${NOT_EXCLUDED}
        AND is_transfer = 0
        AND category IN (${iP})
      GROUP BY category
      HAVING income > 0
    `).all(...months, ...accountIds, ...incomeCats)
  }

  // The pie shows expenses only — income categories are kept out of it.
  const byCategory = expenseByCategory.filter(c => !incomeSet.has(c.category))

  const totals = monthly.reduce((acc, m) => {
    acc.expenses += m.expenses
    acc.income   += m.income
    return acc
  }, { expenses: 0, income: 0 })
  totals.balance = totals.income - totals.expenses

  res.json({
    months, monthly, byCategory, incomeByCategory, totals,
    netBalance: netBalance(db, accountIds),
    budgetTable: buildBudgetTable(db, months, expenseByCategory, incomeByCategory, incomeSet, excludedSet),
  })
})

/**
 * GET /api/stats/matrix?months=2026-01,2026-02,2026-03&accounts=1,3
 * Per-month, per-category expense breakdown for the comparison matrix table.
 * Returns only expense categories (income and excluded categories are omitted).
 *
 * Response:
 *   {
 *     months: ['2026-01', ...],
 *     rows: [{ category, byMonth: { '2026-01': 1234, ... } }],   // sorted by total desc
 *     totals: { '2026-01': 1234, ... },   // expenses per month
 *     income: { '2026-01': 5678, ... },   // income per month
 *     net:    { '2026-01': 4444, ... }    // income - expenses per month
 *   }
 */
router.get('/matrix', (req, res) => {
  const db = getDb()
  const { months, accountIds } = resolveSelection(db, req)
  const incomeSet = new Set(incomeCategoryNames(db))
  const excludedSet = new Set(excludedCategoryNames(db))

  if (accountIds.length === 0) {
    const empty = Object.fromEntries(months.map(m => [m, 0]))
    return res.json({ months, rows: [], totals: empty, income: { ...empty }, net: { ...empty } })
  }

  const mP = months.map(() => '?').join(',')
  const aP = accountIds.map(() => '?').join(',')
  const excludedCats = [...excludedSet]
  const catClause = excludedCats.length
    ? `AND category NOT IN (${excludedCats.map(() => '?').join(',')})`
    : ''

  const raw = db.prepare(`
    SELECT category, substr(date, 1, 7) AS month,
           SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END) AS expenses
    FROM transactions
    WHERE substr(date, 1, 7) IN (${mP})
      AND account_id IN (${aP})
      AND ${NOT_EXCLUDED}
      AND is_transfer = 0
      ${catClause}
    GROUP BY category, month
    HAVING expenses > 0
    ORDER BY category, month
  `).all(...months, ...accountIds, ...excludedCats)

  // Group by category, filter out income categories
  const catMap = new Map()
  for (const r of raw) {
    if (incomeSet.has(r.category)) continue
    if (!catMap.has(r.category)) catMap.set(r.category, {})
    catMap.get(r.category)[r.month] = r.expenses
  }

  const rows = [...catMap.entries()]
    .map(([category, byMonth]) => ({
      category,
      byMonth,
      total: Object.values(byMonth).reduce((s, v) => s + v, 0),
    }))
    .sort((a, b) => b.total - a.total)

  const totals = Object.fromEntries(months.map(m => [m, 0]))
  for (const row of rows) {
    for (const [m, v] of Object.entries(row.byMonth)) {
      totals[m] = (totals[m] || 0) + v
    }
  }

  // Income per month — all positive, non-transfer, non-excluded money, matching
  // how the Overview computes monthly income.
  const incomeRows = db.prepare(`
    SELECT substr(date, 1, 7) AS month,
           SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS income
    FROM transactions
    WHERE substr(date, 1, 7) IN (${mP})
      AND account_id IN (${aP})
      AND ${NOT_EXCLUDED}
      AND is_transfer = 0
      ${catClause}
    GROUP BY month
  `).all(...months, ...accountIds, ...excludedCats)
  const income = Object.fromEntries(months.map(m => [m, 0]))
  for (const r of incomeRows) income[r.month] = r.income

  // Net = income - expenses for each month.
  const net = Object.fromEntries(months.map(m => [m, (income[m] || 0) - (totals[m] || 0)]))

  res.json({ months, rows: rows.map(({ category, byMonth }) => ({ category, byMonth })), totals, income, net })
})

/**
 * GET /api/stats/transactions?category=..&months=..&accounts=..
 * The transactions behind a chart slice: a category within the selected months
 * and accounts, newest first. Used by the Overview pie drill-down.
 */
router.get('/transactions', (req, res) => {
  const db = getDb()
  const { months, accountIds } = resolveSelection(db, req)
  const category = req.query.category
  if (!category) return res.status(400).json({ error: 'category is required' })
  if (accountIds.length === 0) return res.json({ category, rows: [] })

  const mP = months.map(() => '?').join(',')
  const aP = accountIds.map(() => '?').join(',')
  const rows = db.prepare(`
    SELECT id, date, description, amount, category, account_number, account_name, source,
           type, installment_number, installment_total, note,
           (SELECT label FROM subaccount_labels sl
              WHERE sl.account_id = transactions.account_id
                AND sl.account_number = transactions.account_number) AS account_label
    FROM transactions
    WHERE category = ?
      AND substr(date, 1, 7) IN (${mP})
      AND account_id IN (${aP})
      AND ${NOT_EXCLUDED}
      AND is_transfer = 0
    ORDER BY date DESC, id DESC
  `).all(category, ...months, ...accountIds)
  res.json({ category, rows })
})

export default router
