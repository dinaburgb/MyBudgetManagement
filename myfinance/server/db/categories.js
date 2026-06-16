/**
 * Category store — the user-manageable list of categories lives in the DB.
 *
 * Seeded with the canonical Hebrew set on first run. The user can then add,
 * rename, recolor, or delete categories. Renames and deletes propagate to the
 * data: a rename rewrites the category on transactions/rules/budgets; a delete
 * reassigns transactions/rules to 'אחר' and drops that category's budgets.
 * The 'אחר' category is a system category and cannot be deleted.
 */

import { getDb } from './database.js'
import { CATEGORIES_HE, OTHER_CATEGORY } from './categorize.js'

// Default chart colors assigned to seeded and newly-created categories.
const PALETTE = [
  '#60a5fa', '#34d399', '#f472b6', '#fbbf24', '#a78bfa',
  '#f87171', '#22d3ee', '#fb923c', '#4ade80', '#e879f9',
  '#2dd4bf', '#facc15', '#818cf8', '#fca5a5', '#94a3b8',
]

/** Seed the canonical categories on first run. No-op once any category exists. */
export function seedCategories(db = getDb()) {
  const count = db.prepare(`SELECT COUNT(*) AS c FROM categories`).get().c
  if (count > 0) return 0
  const stmt = db.prepare(
    `INSERT INTO categories (name, color, is_system, sort_order) VALUES (?, ?, ?, ?)`
  )
  db.exec('BEGIN')
  try {
    CATEGORIES_HE.forEach((name, i) => {
      stmt.run(name, PALETTE[i % PALETTE.length], name === OTHER_CATEGORY ? 1 : 0, i)
    })
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  return CATEGORIES_HE.length
}

/**
 * One-time rename of the legacy 'דלק' (fuel) category row to 'רכב' (vehicle),
 * broadening it to all car expenses. Transaction/rule/budget values are moved by
 * migrateCategoriesToHebrew (via the 'דלק'→'רכב' normalize entry); this just
 * renames the category row so the list stays in sync. Idempotent.
 */
export function migrateFuelToVehicle(db = getDb()) {
  const fuel = db.prepare(`SELECT id FROM categories WHERE name = 'דלק'`).get()
  const veh  = db.prepare(`SELECT id FROM categories WHERE name = 'רכב'`).get()
  if (fuel && !veh) {
    db.prepare(`UPDATE categories SET name = 'רכב' WHERE id = ?`).run(fuel.id)
    return 1
  }
  // If both somehow exist, drop the now-empty fuel row (data already moved).
  if (fuel && veh) {
    db.prepare(`DELETE FROM categories WHERE id = ?`).run(fuel.id)
    return 1
  }
  return 0
}

/**
 * Move a category one step up or down in the manual display order by swapping its
 * sort_order with the adjacent neighbour. `direction` is 'up' or 'down'. Returns
 * true if a swap happened, false if the category is already at the edge.
 * Mirrors moveAccount in accounts.js.
 */
export function moveCategory(db, id, direction) {
  const me = db.prepare(`SELECT id, sort_order, is_income FROM categories WHERE id = ?`).get(id)
  if (!me) return false
  // 'up' = higher in the list = a smaller sort_order. Tie-break on id so equal
  // sort_orders still move. Stay within the same section (income vs expense) so the
  // Budgets page reorders income among income and expenses among expenses.
  const neighbour = direction === 'up'
    ? db.prepare(`SELECT id, sort_order FROM categories
                  WHERE is_income = ? AND (sort_order < ? OR (sort_order = ? AND id < ?))
                  ORDER BY sort_order DESC, id DESC LIMIT 1`).get(me.is_income, me.sort_order, me.sort_order, me.id)
    : db.prepare(`SELECT id, sort_order FROM categories
                  WHERE is_income = ? AND (sort_order > ? OR (sort_order = ? AND id > ?))
                  ORDER BY sort_order ASC, id ASC LIMIT 1`).get(me.is_income, me.sort_order, me.sort_order, me.id)
  if (!neighbour) return false

  db.exec('BEGIN')
  try {
    db.prepare(`UPDATE categories SET sort_order = ? WHERE id = ?`).run(neighbour.sort_order, me.id)
    db.prepare(`UPDATE categories SET sort_order = ? WHERE id = ?`).run(me.sort_order, neighbour.id)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  return true
}

/** All categories, ordered for display. */
export function listCategories(db = getDb()) {
  return db.prepare(
    `SELECT id, name, color, is_system, is_income, is_excluded FROM categories ORDER BY sort_order, id`
  ).all()
}

/** Just the category names (used where only names are needed). */
export function listCategoryNames(db = getDb()) {
  return listCategories(db).map(c => c.name)
}

/** Names of categories flagged as income (kept out of the expense pie). */
export function incomeCategoryNames(db = getDb()) {
  return db.prepare(`SELECT name FROM categories WHERE is_income = 1`).all().map(r => r.name)
}

/** Names of categories ignored entirely in totals (e.g. credit-card repayments). */
export function excludedCategoryNames(db = getDb()) {
  return db.prepare(`SELECT name FROM categories WHERE is_excluded = 1`).all().map(r => r.name)
}

/** Add a new category. Throws { code } on bad input or a duplicate name. */
export function addCategory(db, name, color, { is_income = 0, is_excluded = 0 } = {}) {
  name = (name || '').trim()
  if (!name) throw Object.assign(new Error('name required'), { code: 'INVALID' })
  if (db.prepare(`SELECT 1 FROM categories WHERE name = ?`).get(name)) {
    throw Object.assign(new Error('exists'), { code: 'EXISTS' })
  }
  const agg = db.prepare(`SELECT MAX(sort_order) AS m, COUNT(*) AS c FROM categories`).get()
  const col = color || PALETTE[agg.c % PALETTE.length]
  const r = db.prepare(
    `INSERT INTO categories (name, color, is_system, is_income, is_excluded, sort_order) VALUES (?, ?, 0, ?, ?, ?)`
  ).run(name, col, is_income ? 1 : 0, is_excluded ? 1 : 0, (agg.m || 0) + 1)
  return { id: r.lastInsertRowid }
}

/** Rename, recolor, and/or set the income/excluded flags of a category. A rename propagates to all data. */
export function updateCategory(db, id, { name, color, is_income, is_excluded }) {
  const cat = db.prepare(`SELECT * FROM categories WHERE id = ?`).get(id)
  if (!cat) throw Object.assign(new Error('not found'), { code: 'NOT_FOUND' })

  db.exec('BEGIN')
  try {
    let newName = cat.name
    const trimmed = (name || '').trim()
    if (trimmed && trimmed !== cat.name) {
      if (db.prepare(`SELECT 1 FROM categories WHERE name = ? AND id != ?`).get(trimmed, id)) {
        throw Object.assign(new Error('exists'), { code: 'EXISTS' })
      }
      newName = trimmed
      db.prepare(`UPDATE transactions   SET category = ? WHERE category = ?`).run(newName, cat.name)
      db.prepare(`UPDATE category_rules SET category = ? WHERE category = ?`).run(newName, cat.name)
      db.prepare(`UPDATE budgets        SET category = ? WHERE category = ?`).run(newName, cat.name)
    }
    const income   = is_income   === undefined ? cat.is_income   : (is_income   ? 1 : 0)
    const excluded = is_excluded === undefined ? cat.is_excluded : (is_excluded ? 1 : 0)
    db.prepare(`UPDATE categories SET name = ?, color = ?, is_income = ?, is_excluded = ? WHERE id = ?`)
      .run(newName, color || cat.color, income, excluded, id)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

/**
 * Delete a category and move its data to another category. `target` is the
 * destination category name; when omitted (or invalid) the data goes to 'אחר'.
 * System categories can't be deleted, and a category can't be moved into itself.
 */
export function deleteCategory(db, id, target) {
  const cat = db.prepare(`SELECT * FROM categories WHERE id = ?`).get(id)
  if (!cat) throw Object.assign(new Error('not found'), { code: 'NOT_FOUND' })
  if (cat.is_system) throw Object.assign(new Error('system category'), { code: 'SYSTEM' })

  // Resolve the destination: a real, different category, else fall back to 'אחר'.
  let dest = (target || '').trim()
  if (!dest || dest === cat.name || !db.prepare(`SELECT 1 FROM categories WHERE name = ?`).get(dest)) {
    dest = OTHER_CATEGORY
  }

  db.exec('BEGIN')
  try {
    db.prepare(`UPDATE transactions   SET category = ? WHERE category = ?`).run(dest, cat.name)
    db.prepare(`UPDATE category_rules SET category = ? WHERE category = ?`).run(dest, cat.name)
    db.prepare(`DELETE FROM budgets WHERE category = ?`).run(cat.name)
    db.prepare(`DELETE FROM categories WHERE id = ?`).run(id)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  return { dest }
}
