/**
 * Budget logic — monthly spending limits per category.
 *
 * A budget row is either a recurring default (month = '') that applies to every
 * month, or a one-month override (month = 'YYYY-MM'). The effective limit for a
 * category in a given month is the override if one exists, otherwise the default.
 *
 * "Spent" for a category in a month is the sum of that month's expenses (negative
 * amounts) in that category, counting only accounts included in totals.
 */

import { getDb } from './database.js'
import { listCategoryNames, excludedCategoryNames, incomeCategoryNames } from './categories.js'
import { notExcludedSql } from './subaccounts.js'

/** Validate a 'YYYY-MM' string. */
export function isValidMonth(m) {
  return typeof m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(m)
}

/** Inclusive list of 'YYYY-MM' months from start to end (assumes start <= end). */
function monthsBetween(start, end) {
  const out = []
  let [y, m] = start.split('-').map(Number)
  const [ey, em] = end.split('-').map(Number)
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    m++; if (m > 12) { m = 1; y++ }
  }
  return out
}

/**
 * Build the full budget overview for a month: every category with its effective
 * limit (and where it came from) plus how much was spent.
 *
 * @param {object} db
 * @param {string} month - 'YYYY-MM'
 * @returns {Array<{category, limit, source, spent, remaining}>}
 */
export function computeBudgetOverview(db = getDb(), month) {
  // Effective limit per category: override (this month) wins over default ('').
  const limitRows = db.prepare(
    `SELECT category, month, amount, effective_from FROM budgets WHERE month = '' OR month = ?`
  ).all(month)

  const defaults = new Map()
  const defaultFrom = new Map()   // category -> 'YYYY-MM' the recurring default starts ('' = always)
  const overrides = new Map()
  for (const r of limitRows) {
    if (r.month === '') { defaults.set(r.category, r.amount); defaultFrom.set(r.category, r.effective_from || '') }
    else overrides.set(r.category, r.amount)
  }

  // Accumulated envelope balance per category from the budget's start through this month.
  const envelope = budgetEnvelope(db, month)

  // Spending per category for the month, from included accounts only.
  const spentRows = db.prepare(`
    SELECT t.category AS category,
           SUM(CASE WHEN t.amount < 0 THEN -t.amount ELSE 0 END) AS spent
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE a.include_in_totals = 1
      AND ${notExcludedSql('t.account_id', 't.account_number')}
      AND t.is_transfer = 0
      AND substr(t.date, 1, 7) = ?
    GROUP BY t.category
  `).all(month)
  const spentByCat = new Map(spentRows.map(r => [r.category, r.spent || 0]))

  // One row per known category, plus any category that has a budget or spending
  // but isn't in the canonical list (defensive). Excluded categories (e.g. a
  // credit-card repayment) never get a budget row. Income categories are handled
  // separately (see computeIncomeOverview) — they're earnings, not spending, so
  // they don't belong among the expense tiles or in the expense budget total.
  const excluded = new Set(excludedCategoryNames(db))
  const income = new Set(incomeCategoryNames(db))
  const categories = [...new Set([
    ...listCategoryNames(db),
    ...defaults.keys(), ...overrides.keys(), ...spentByCat.keys(),
  ])].filter(c => !excluded.has(c) && !income.has(c))

  return categories.map(category => {
    const hasOverride = overrides.has(category)
    const limit = hasOverride ? overrides.get(category)
                : defaults.has(category) ? defaults.get(category)
                : null
    const spent = spentByCat.get(category) || 0
    return {
      category,
      limit,
      source: hasOverride ? 'month' : (limit != null ? 'default' : null),
      effectiveFrom: defaultFrom.get(category) || '',
      spent,
      remaining: limit != null ? limit - spent : null,
      // Running balance of (limit - spent) accumulated from the budget's start
      // month through the selected month. null when the category has no budget.
      carryover: limit != null ? (envelope.get(category) ?? null) : null,
    }
  })
}

/**
 * Income overview for a month: one row per income-flagged category with its
 * expected-income target (the "budget" for income), how much was actually earned
 * (sum of positive amounts), and the gap to target. Mirrors computeBudgetOverview
 * but for earnings — no envelope/carryover (income isn't an envelope).
 *
 * @returns {Array<{category, kind:'income', limit, source, earned, remaining}>}
 */
export function computeIncomeOverview(db = getDb(), month) {
  const income = new Set(incomeCategoryNames(db))
  if (income.size === 0) return []

  const limitRows = db.prepare(
    `SELECT category, month, amount FROM budgets WHERE month = '' OR month = ?`
  ).all(month)
  const defaults = new Map()
  const overrides = new Map()
  for (const r of limitRows) {
    if (r.month === '') defaults.set(r.category, r.amount)
    else overrides.set(r.category, r.amount)
  }

  // Earned per category for the month: sum of positive amounts, included accounts.
  const earnedRows = db.prepare(`
    SELECT t.category AS category,
           SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END) AS earned
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE a.include_in_totals = 1
      AND ${notExcludedSql('t.account_id', 't.account_number')}
      AND t.is_transfer = 0
      AND substr(t.date, 1, 7) = ?
    GROUP BY t.category
  `).all(month)
  const earnedByCat = new Map(earnedRows.map(r => [r.category, r.earned || 0]))

  const categories = [...new Set([
    ...listCategoryNames(db).filter(c => income.has(c)),
    ...defaults.keys(), ...overrides.keys(), ...earnedByCat.keys(),
  ])].filter(c => income.has(c))

  return categories.map(category => {
    const hasOverride = overrides.has(category)
    const limit = hasOverride ? overrides.get(category)
                : defaults.has(category) ? defaults.get(category)
                : null
    const earned = earnedByCat.get(category) || 0
    return {
      category,
      kind: 'income',
      limit,
      source: hasOverride ? 'month' : (limit != null ? 'default' : null),
      earned,
      remaining: limit != null ? limit - earned : null,
    }
  })
}

/** Effective limit for a category in a given month: month override wins; otherwise
 *  the recurring default, but only from its effective_from month onward. */
function effectiveLimit(category, month, defaults, defaultFrom, overrideByKey) {
  const ov = overrideByKey.get(`${category}|${month}`)
  if (ov != null) return ov
  if (defaults.has(category)) {
    const from = defaultFrom.get(category) || ''
    if (!isValidMonth(from) || from <= month) return defaults.get(category)
  }
  return null
}

/**
 * Accumulated "envelope" balance per category: the running sum of (limit - spent)
 * for every month from the budget's start through `throughMonth`, inclusive. Both
 * under-spend (carries forward as +) and over-spend (carries as -) accumulate.
 *
 * A category's start month is its default's effective_from when set, else its
 * earliest month override, else January of throughMonth's year (legacy fallback).
 *
 * @returns {Map<string, number>} category -> accumulated balance
 */
export function budgetEnvelope(db, throughMonth) {
  const defaultRows  = db.prepare(`SELECT category, amount, effective_from FROM budgets WHERE month = ''`).all()
  const overrideRows = db.prepare(`SELECT category, month, amount FROM budgets WHERE month != ''`).all()

  const defaults = new Map(defaultRows.map(r => [r.category, r.amount]))
  const defaultFrom = new Map(defaultRows.map(r => [r.category, r.effective_from || '']))
  const overrideByKey = new Map()           // 'cat|YYYY-MM' -> amount
  const overrideMonthsByCat = new Map()     // cat -> [months]
  for (const r of overrideRows) {
    overrideByKey.set(`${r.category}|${r.month}`, r.amount)
    if (!overrideMonthsByCat.has(r.category)) overrideMonthsByCat.set(r.category, [])
    overrideMonthsByCat.get(r.category).push(r.month)
  }

  const year = throughMonth.slice(0, 4)
  const cats = new Set([...defaults.keys(), ...overrideMonthsByCat.keys()])

  // Resolve each category's start month and find the earliest across all (the
  // range we need spending data for).
  const startByCat = new Map()
  let earliest = throughMonth
  for (const cat of cats) {
    let start = ''
    const from = defaultFrom.get(cat) || ''
    if (defaults.has(cat) && isValidMonth(from)) start = from
    if (!start && overrideMonthsByCat.has(cat)) {
      start = [...overrideMonthsByCat.get(cat)].sort()[0]
    }
    if (!start) start = `${year}-01`
    if (start > throughMonth) start = throughMonth
    startByCat.set(cat, start)
    if (start < earliest) earliest = start
  }

  // Spent per category per month across the whole range, in one query.
  const months = monthsBetween(earliest, throughMonth)
  const spentByKey = spentByCategoryMonth(db, months)

  const result = new Map()
  for (const cat of cats) {
    let acc = 0
    for (const m of monthsBetween(startByCat.get(cat), throughMonth)) {
      const limit = effectiveLimit(cat, m, defaults, defaultFrom, overrideByKey)
      if (limit == null) continue
      acc += limit - (spentByKey.get(`${cat}|${m}`) || 0)
    }
    result.set(cat, acc)
  }
  return result
}

/** Spent per category per month for a set of months, from included accounts only.
 *  @returns {Map<string, number>} 'cat|YYYY-MM' -> spent */
function spentByCategoryMonth(db, months) {
  if (!months.length) return new Map()
  const ph = months.map(() => '?').join(',')
  const rows = db.prepare(`
    SELECT t.category AS category, substr(t.date, 1, 7) AS month,
           SUM(CASE WHEN t.amount < 0 THEN -t.amount ELSE 0 END) AS spent
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE a.include_in_totals = 1
      AND ${notExcludedSql('t.account_id', 't.account_number')}
      AND t.is_transfer = 0
      AND substr(t.date, 1, 7) IN (${ph})
    GROUP BY t.category, substr(t.date, 1, 7)
  `).all(...months)
  return new Map(rows.map(r => [`${r.category}|${r.month}`, r.spent || 0]))
}

/**
 * Total effective budget per category across a set of months. For each month the
 * effective limit is the month override if present, else the recurring default.
 * Limits are summed across the months; a category with no limit in ANY of the
 * months gets `budget: null` (so the UI can leave the cell empty). For months
 * where a category has no limit but does in another month, that month contributes
 * 0 — the sum still reflects only the months it was actually budgeted.
 *
 * @param {object} db
 * @param {string[]} months - array of 'YYYY-MM'
 * @returns {Map<string, number>} category → summed budget (only categories with one)
 */
export function budgetSummaryForMonths(db, months) {
  const defaultRow = db.prepare(`SELECT category, amount FROM budgets WHERE month = ''`).all()
  const defaults = new Map(defaultRow.map(r => [r.category, r.amount]))

  const overrideStmt = db.prepare(`SELECT category, amount FROM budgets WHERE month = ?`)
  const totals = new Map()
  for (const month of months) {
    const overrides = new Map(overrideStmt.all(month).map(r => [r.category, r.amount]))
    // Every category that has a limit this month (override wins over default).
    const cats = new Set([...defaults.keys(), ...overrides.keys()])
    for (const cat of cats) {
      const limit = overrides.has(cat) ? overrides.get(cat) : defaults.get(cat)
      if (limit == null) continue
      totals.set(cat, (totals.get(cat) || 0) + limit)
    }
  }
  return totals
}

/**
 * The transactions behind a budget row: a category's charges for the given month,
 * from accounts included in totals (the same set "spent" is computed from),
 * newest first. Used by the Budgets page drill-down.
 */
export function budgetCategoryTransactions(db, category, month) {
  return db.prepare(`
    SELECT t.id, t.date, t.description, t.amount, t.account_name, t.source,
           t.type, t.installment_number, t.installment_total, t.note
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE a.include_in_totals = 1
      AND ${notExcludedSql('t.account_id', 't.account_number')}
      AND t.is_transfer = 0
      AND t.category = ?
      AND substr(t.date, 1, 7) = ?
    ORDER BY t.date DESC, t.id DESC
  `).all(category, month)
}

/**
 * Suggest a monthly budget per category = average monthly spend over the last
 * `monthsBack` COMPLETE months (excluding the current partial month), from
 * included accounts/sub-accounts. Income and excluded categories are skipped.
 * Rounded to the nearest 10 for tidy numbers. Returns { months, suggestions }.
 */
export function budgetSuggestions(db = getDb(), monthsBack = 6) {
  const now = new Date()
  const months = []
  for (let i = 1; i <= monthsBack; i++) {
    const m = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`)
  }
  const mP = months.map(() => '?').join(',')
  const rows = db.prepare(`
    SELECT t.category AS category,
           SUM(CASE WHEN t.amount < 0 THEN -t.amount ELSE 0 END) AS spent
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE a.include_in_totals = 1
      AND ${notExcludedSql('t.account_id', 't.account_number')}
      AND t.is_transfer = 0
      AND substr(t.date, 1, 7) IN (${mP})
      AND t.category NOT IN (SELECT name FROM categories WHERE is_excluded = 1 OR is_income = 1)
    GROUP BY t.category
  `).all(...months)

  const suggestions = {}
  for (const r of rows) {
    const avg = (r.spent || 0) / monthsBack
    if (avg <= 0) continue
    suggestions[r.category] = Math.round(avg / 10) * 10   // nearest 10
  }
  return { months, suggestions }
}

/**
 * Insert or update a budget limit for a category.
 * month '' sets the recurring default; a 'YYYY-MM' sets a one-month override.
 */
export function setBudget(db, category, amount, month = '', effectiveFrom = '') {
  // effective_from only applies to the recurring default (month = ''); a one-month
  // override is itself tied to a specific month.
  const from = month === '' && isValidMonth(effectiveFrom) ? effectiveFrom : ''
  return db.prepare(`
    INSERT INTO budgets (category, month, amount, effective_from) VALUES (?, ?, ?, ?)
    ON CONFLICT(category, month)
    DO UPDATE SET amount = excluded.amount, effective_from = excluded.effective_from, updated_at = datetime('now')
  `).run(category, month, amount, from)
}

/** Remove a budget limit (a default or a specific month's override). */
export function deleteBudget(db, category, month = '') {
  return db.prepare(`DELETE FROM budgets WHERE category = ? AND month = ?`)
    .run(category, month)
}
