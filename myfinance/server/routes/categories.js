/**
 * Categories API — manage auto-categorization rules and apply them.
 *
 *   GET    /api/categories/rules         list all rules
 *   POST   /api/categories/rules         add a rule { keyword, category, priority? }
 *   DELETE /api/categories/rules/:id     delete a rule
 *   POST   /api/categories/recategorize  apply rules to existing transactions
 *                                        body { mode: 'other' | 'all' } (default 'other')
 *   GET    /api/categories/summary       per-category totals (count + summed amount)
 */

import { Router } from 'express'
import { getDb } from '../db/database.js'
import { isUnlocked } from '../crypto/encryption.js'
import { recategorizeAll, applyRuleToUncategorized, applyKeywordToAll, AUTHORITATIVE_PRIORITY } from '../db/categorize.js'
import { listCategories, addCategory, updateCategory, deleteCategory } from '../db/categories.js'

const router = Router()

router.use((req, res, next) => {
  if (!isUnlocked()) return res.status(401).json({ error: 'App is locked' })
  next()
})

// --- Manage the category list itself ---

/** GET /api/categories — the full category list (id, name, color, is_system) */
router.get('/', (req, res) => {
  res.json(listCategories(getDb()))
})

/** POST /api/categories — add a custom category { name, color? } */
router.post('/', (req, res) => {
  try {
    const { id } = addCategory(getDb(), req.body.name, req.body.color)
    res.json({ id, message: 'Category added' })
  } catch (err) {
    if (err.code === 'EXISTS')  return res.status(409).json({ error: 'הקטגוריה כבר קיימת' })
    if (err.code === 'INVALID') return res.status(400).json({ error: 'נדרש שם קטגוריה' })
    res.status(500).json({ error: 'Could not add category' })
  }
})

/** PUT /api/categories/:id — rename and/or recolor { name?, color? } */
router.put('/:id', (req, res) => {
  try {
    updateCategory(getDb(), req.params.id, { name: req.body.name, color: req.body.color })
    res.json({ message: 'Category updated' })
  } catch (err) {
    if (err.code === 'EXISTS')    return res.status(409).json({ error: 'הקטגוריה כבר קיימת' })
    if (err.code === 'NOT_FOUND') return res.status(404).json({ error: 'Category not found' })
    res.status(500).json({ error: 'Could not update category' })
  }
})

/** DELETE /api/categories/:id — delete and move its data to 'אחר' */
router.delete('/:id', (req, res) => {
  try {
    deleteCategory(getDb(), req.params.id)
    res.json({ message: 'Category deleted' })
  } catch (err) {
    if (err.code === 'SYSTEM')    return res.status(400).json({ error: 'לא ניתן למחוק קטגוריית מערכת' })
    if (err.code === 'NOT_FOUND') return res.status(404).json({ error: 'Category not found' })
    res.status(500).json({ error: 'Could not delete category' })
  }
})

/** GET /api/categories/rules — all rules, highest priority first */
router.get('/rules', (req, res) => {
  const db = getDb()
  const rules = db.prepare(
    `SELECT id, keyword, category, priority, created_at
     FROM category_rules ORDER BY priority DESC, category, keyword`
  ).all()
  res.json(rules)
})

/** POST /api/categories/rules — add a new rule */
router.post('/rules', (req, res) => {
  const { keyword, category, priority } = req.body
  if (!keyword || !category) {
    return res.status(400).json({ error: 'keyword and category are required' })
  }
  const db = getDb()
  const kw = keyword.trim(), cat = category.trim()
  // 'all' mode makes the rule authoritative (high priority) so it also wins over
  // the scraper's own category on future imports — not just a one-time fix.
  const prio = req.body.applyMode === 'all'
    ? Math.max(Number(priority) || 0, AUTHORITATIVE_PRIORITY)
    : Number(priority) || 0
  const result = db.prepare(
    `INSERT INTO category_rules (keyword, category, priority) VALUES (?, ?, ?)`
  ).run(kw, cat, prio)
  // Apply the new rule to existing transactions right away. Default touches only
  // uncategorized rows; 'all' overrides already-categorized matches too (used to
  // pull charges into a category like רכב from wherever they currently sit).
  const applied = req.body.applyMode === 'all'
    ? applyKeywordToAll(db, kw, cat)
    : applyRuleToUncategorized(db, kw, cat)
  res.json({ id: result.lastInsertRowid, message: 'Rule added', applied })
})

/** DELETE /api/categories/rules/:id — remove a rule */
router.delete('/rules/:id', (req, res) => {
  const db = getDb()
  db.prepare(`DELETE FROM category_rules WHERE id = ?`).run(req.params.id)
  res.json({ message: 'Rule deleted' })
})

/**
 * POST /api/categories/recategorize — apply the current rules to existing
 * transactions. mode 'other' (default) only touches uncategorized rows so manual
 * choices are kept; mode 'all' re-evaluates every transaction.
 */
router.post('/recategorize', (req, res) => {
  const mode = req.body?.mode === 'all' ? 'all' : 'other'
  const result = recategorizeAll(getDb(), { onlyOther: mode === 'other' })
  res.json({ message: 'Re-categorization complete', mode, ...result })
})

/** GET /api/categories/summary — count and total amount per category */
router.get('/summary', (req, res) => {
  const db = getDb()
  // Only count transactions from accounts marked as included in totals. An
  // account excluded by the user (e.g. a separate/relative's account) is left
  // out of the summary entirely.
  const rows = db.prepare(`
    SELECT t.category,
           COUNT(*)                                     AS count,
           SUM(t.amount)                                AS total,
           SUM(CASE WHEN t.amount < 0 THEN t.amount ELSE 0 END) AS expenses,
           SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END) AS income
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE a.include_in_totals = 1
    GROUP BY t.category
    ORDER BY expenses ASC
  `).all()
  res.json(rows)
})

export default router
