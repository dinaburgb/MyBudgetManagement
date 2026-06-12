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

/** All categories, ordered for display. */
export function listCategories(db = getDb()) {
  return db.prepare(
    `SELECT id, name, color, is_system FROM categories ORDER BY sort_order, id`
  ).all()
}

/** Just the category names (used where only names are needed). */
export function listCategoryNames(db = getDb()) {
  return listCategories(db).map(c => c.name)
}

/** Add a new category. Throws { code } on bad input or a duplicate name. */
export function addCategory(db, name, color) {
  name = (name || '').trim()
  if (!name) throw Object.assign(new Error('name required'), { code: 'INVALID' })
  if (db.prepare(`SELECT 1 FROM categories WHERE name = ?`).get(name)) {
    throw Object.assign(new Error('exists'), { code: 'EXISTS' })
  }
  const agg = db.prepare(`SELECT MAX(sort_order) AS m, COUNT(*) AS c FROM categories`).get()
  const col = color || PALETTE[agg.c % PALETTE.length]
  const r = db.prepare(
    `INSERT INTO categories (name, color, is_system, sort_order) VALUES (?, ?, 0, ?)`
  ).run(name, col, (agg.m || 0) + 1)
  return { id: r.lastInsertRowid }
}

/** Rename and/or recolor a category, propagating a rename to all data. */
export function updateCategory(db, id, { name, color }) {
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
    db.prepare(`UPDATE categories SET name = ?, color = ? WHERE id = ?`)
      .run(newName, color || cat.color, id)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

/** Delete a category and move its data to 'אחר'. System categories can't be deleted. */
export function deleteCategory(db, id) {
  const cat = db.prepare(`SELECT * FROM categories WHERE id = ?`).get(id)
  if (!cat) throw Object.assign(new Error('not found'), { code: 'NOT_FOUND' })
  if (cat.is_system) throw Object.assign(new Error('system category'), { code: 'SYSTEM' })

  db.exec('BEGIN')
  try {
    db.prepare(`UPDATE transactions   SET category = ? WHERE category = ?`).run(OTHER_CATEGORY, cat.name)
    db.prepare(`UPDATE category_rules SET category = ? WHERE category = ?`).run(OTHER_CATEGORY, cat.name)
    db.prepare(`DELETE FROM budgets WHERE category = ?`).run(cat.name)
    db.prepare(`DELETE FROM categories WHERE id = ?`).run(id)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}
