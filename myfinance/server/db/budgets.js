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
import { CATEGORIES_HE } from './categorize.js'

/** Validate a 'YYYY-MM' string. */
export function isValidMonth(m) {
  return typeof m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(m)
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
    `SELECT category, month, amount FROM budgets WHERE month = '' OR month = ?`
  ).all(month)

  const defaults = new Map()
  const overrides = new Map()
  for (const r of limitRows) {
    if (r.month === '') defaults.set(r.category, r.amount)
    else overrides.set(r.category, r.amount)
  }

  // Spending per category for the month, from included accounts only.
  const spentRows = db.prepare(`
    SELECT t.category AS category,
           SUM(CASE WHEN t.amount < 0 THEN -t.amount ELSE 0 END) AS spent
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE a.include_in_totals = 1
      AND substr(t.date, 1, 7) = ?
    GROUP BY t.category
  `).all(month)
  const spentByCat = new Map(spentRows.map(r => [r.category, r.spent || 0]))

  // One row per known category, plus any category that has a budget or spending
  // but isn't in the canonical list (defensive).
  const categories = new Set([
    ...CATEGORIES_HE,
    ...defaults.keys(), ...overrides.keys(), ...spentByCat.keys(),
  ])

  return [...categories].map(category => {
    const hasOverride = overrides.has(category)
    const limit = hasOverride ? overrides.get(category)
                : defaults.has(category) ? defaults.get(category)
                : null
    const spent = spentByCat.get(category) || 0
    return {
      category,
      limit,
      source: hasOverride ? 'month' : (limit != null ? 'default' : null),
      spent,
      remaining: limit != null ? limit - spent : null,
    }
  })
}

/**
 * Insert or update a budget limit for a category.
 * month '' sets the recurring default; a 'YYYY-MM' sets a one-month override.
 */
export function setBudget(db, category, amount, month = '') {
  return db.prepare(`
    INSERT INTO budgets (category, month, amount) VALUES (?, ?, ?)
    ON CONFLICT(category, month)
    DO UPDATE SET amount = excluded.amount, updated_at = datetime('now')
  `).run(category, month, amount)
}

/** Remove a budget limit (a default or a specific month's override). */
export function deleteBudget(db, category, month = '') {
  return db.prepare(`DELETE FROM budgets WHERE category = ? AND month = ?`)
    .run(category, month)
}
