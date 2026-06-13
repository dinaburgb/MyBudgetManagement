/**
 * Auto-categorization engine.
 *
 * A category rule maps a keyword to a category. When a transaction's description
 * contains the keyword (case-insensitive substring match), the transaction gets
 * that category. Rules are checked from highest priority to lowest; the first
 * match wins. Descriptions and keywords are compared in lowercase.
 *
 * The rules live in the `category_rules` table (see schema.js). This module
 * loads them, applies them to a description, seeds a useful default set on first
 * run, and can re-categorize existing transactions on demand.
 */

import { getDb } from './database.js'

/**
 * Rules at or above this priority are "authoritative": they override even the
 * category the scraper itself provided, on import and when re-applied. Normal
 * rules (below this) only fill in when the scraper gave no category. This lets a
 * high-confidence keyword like "רב קו" or "מוסך" win every time, instead of the
 * scraper's own, messier taxonomy.
 */
export const AUTHORITATIVE_PRIORITY = 100

/**
 * Curated keyword→category rules we always want to hold, regardless of what the
 * scraper returns. Seeded as authoritative (high priority) and applied to
 * existing transactions the first time each one is added (see ensureEssentialRules).
 * Grounded in the real descriptions in this database.
 */
export const ESSENTIAL_RULES = [
  // Public transport top-ups are the kids' — keep them under "ילדים", not "רכב".
  ['רב קו', 'ילדים'],
  // Private-vehicle running costs all roll up into "רכב".
  ['דלק', 'רכב'],
  ['מוסך', 'רכב'],
  ['פנגו', 'רכב'],
  ['סלופארק', 'רכב'],
  ['משרד התחבורה', 'רכב'],
  ['רשיונות רכ', 'רכב'],   // "משרד התחבורה - רשיונות רכ" (note spelling: רשיון, no first yud)
  ['רישוי', 'רכב'],
  ['אגרת רכב', 'רכב'],
  ['קנס', 'רכב'],          // traffic fines; no such rows yet, here for the future
]

/**
 * Default rules seeded on first run. Keywords cover common Israeli merchants and
 * services, in both Hebrew and English (cards often return Latin-letter names).
 * Keywords are matched as lowercased substrings of the description.
 *
 * The user can add, edit, or delete these later from the Categories page —
 * they are only a starting point.
 */
export const DEFAULT_RULES = [
  // Groceries / supermarkets
  ['שופרסל', 'Groceries'], ['shufersal', 'Groceries'], ['supersol', 'Groceries'],
  ['רמי לוי', 'Groceries'], ['rami levy', 'Groceries'], ['ויקטורי', 'Groceries'],
  ['יוחננוף', 'Groceries'], ['אושר עד', 'Groceries'], ['טיב טעם', 'Groceries'],
  ['יינות ביתן', 'Groceries'], ['מגה', 'Groceries'], ['סטופ מרקט', 'Groceries'],
  // Restaurants / cafes / food delivery
  ['מסעדה', 'Restaurants'], ['קפה', 'Restaurants'], ['cafe', 'Restaurants'],
  ['ארומה', 'Restaurants'], ['aroma', 'Restaurants'], ['רולדין', 'Restaurants'],
  ['מקדונלד', 'Restaurants'], ['mcdonald', 'Restaurants'], ['בורגר', 'Restaurants'],
  ['פיצה', 'Restaurants'], ['pizza', 'Restaurants'], ['wolt', 'Restaurants'],
  ['וולט', 'Restaurants'], ['10bis', 'Restaurants'], ['תן ביס', 'Restaurants'],
  // Vehicle (רכב): fuel, garage, licensing, mandatory car insurance
  ['פז', 'Fuel'], ['paz', 'Fuel'], ['דלק', 'Fuel'], ['delek', 'Fuel'],
  ['סונול', 'Fuel'], ['sonol', 'Fuel'], ['דור אלון', 'Fuel'], ['ten', 'Fuel'],
  ['תחנת דלק', 'רכב'], ['מוסך', 'רכב'], ['רישוי', 'רכב'], ['עידן הרכב', 'רכב'],
  ['רכב חובה', 'רכב'],
  // Transport
  ['רכבת', 'Transport'], ['אגד', 'Transport'], ['רב קו', 'Transport'],
  ['רב-קו', 'Transport'], ['מטרופולין', 'Transport'], ['פנגו', 'Transport'],
  ['pango', 'Transport'], ['cellopark', 'Transport'], ['סלופארק', 'Transport'],
  // Healthcare / pharmacy
  ['סופר פארם', 'Healthcare'], ['super-pharm', 'Healthcare'], ['superpharm', 'Healthcare'],
  ['מכבי', 'Healthcare'], ['כללית', 'Healthcare'], ['clalit', 'Healthcare'],
  ['מאוחדת', 'Healthcare'], ['לאומית', 'Healthcare'], ['בית מרקחת', 'Healthcare'],
  // Utilities
  ['חברת חשמל', 'Utilities'], ['חשמל', 'Utilities'], ['מקורות', 'Utilities'],
  ['ארנונה', 'Utilities'], ['עיריית', 'Utilities'], ['גז', 'Utilities'],
  // Communications
  ['פרטנר', 'Communications'], ['partner', 'Communications'], ['סלקום', 'Communications'],
  ['cellcom', 'Communications'], ['בזק', 'Communications'], ['bezeq', 'Communications'],
  ['hot', 'Communications'], ['הוט', 'Communications'], ['פלאפון', 'Communications'],
  ['pelephone', 'Communications'], ['גולן', 'Communications'], ['yes', 'Communications'],
  // Shopping
  ['זארה', 'Shopping'], ['zara', 'Shopping'], ['קסטרו', 'Shopping'], ['castro', 'Shopping'],
  ['fox', 'Shopping'], ['פוקס', 'Shopping'], ['ikea', 'Shopping'], ['איקאה', 'Shopping'],
  ['amazon', 'Shopping'], ['אמזון', 'Shopping'], ['aliexpress', 'Shopping'], ['ace', 'Shopping'],
  // Entertainment / subscriptions
  ['סינמה', 'Entertainment'], ['cinema', 'Entertainment'], ['יס פלאנט', 'Entertainment'],
  ['netflix', 'Entertainment'], ['נטפליקס', 'Entertainment'], ['spotify', 'Entertainment'],
  ['ספוטיפיי', 'Entertainment'], ['steam', 'Entertainment'], ['youtube', 'Entertainment'],
  // Travel
  ['el al', 'Travel'], ['אל על', 'Travel'], ['booking', 'Travel'], ['airbnb', 'Travel'],
  ['מלון', 'Travel'], ['hotel', 'Travel'], ['טיסה', 'Travel'],
  // ATM
  ['משיכת מזומן', 'ATM'], ['כספומט', 'ATM'], ['atm', 'ATM'],
  // Transfers / payments
  ['העברה', 'Transfers'], ['העברת', 'Transfers'], ['paybox', 'Transfers'],
  ['פייבוקס', 'Transfers'], ['bit', 'Transfers'], ['ביט', 'Transfers'],
]

/**
 * The single canonical set of categories — all in Hebrew. Everything in the app
 * (rules, the manual category picker, filters, summaries) uses these values.
 * Keep client/src/categories.js in sync with this list.
 */
export const CATEGORIES_HE = [
  'מזון', 'מסעדות', 'תחבורה', 'רכב', 'בריאות', 'חשבונות בית',
  'תקשורת', 'קניות', 'בידור', 'חינוך', 'נסיעות', 'ביטוח ופיננסים',
  'משיכת מזומן', 'העברות', 'אחר',
]

/** The catch-all category, used when nothing else matches. */
export const OTHER_CATEGORY = 'אחר'

/**
 * Maps any legacy or source-provided category value onto a canonical Hebrew
 * category. Two kinds of keys live here:
 *   1. The old English names we used before going Hebrew.
 *   2. The Hebrew taxonomy the scrapers (esp. Visa Cal) return, which is more
 *      granular and uneven — we fold it into our cleaner list.
 * Anything not listed passes through unchanged (already-canonical values map to
 * themselves), so this is safe to run repeatedly.
 */
export const CATEGORY_NORMALIZE = {
  // --- legacy English ---
  Groceries: 'מזון', Restaurants: 'מסעדות', Transport: 'תחבורה', Fuel: 'רכב',
  Healthcare: 'בריאות', Utilities: 'חשבונות בית', Communications: 'תקשורת',
  Shopping: 'קניות', Entertainment: 'בידור', Education: 'חינוך', Travel: 'נסיעות',
  ATM: 'משיכת מזומן', Transfers: 'העברות', Other: 'אחר',
  // Fuel folds into the broader "vehicle" (רכב) category.
  'דלק': 'רכב',
  // --- Visa Cal / scraper Hebrew taxonomy ---
  'מזון ומשקאות': 'מזון',
  'מסעדות ובתי קפה': 'מסעדות',
  'רכב ותחבורה': 'תחבורה',
  'אנרגיה': 'רכב',
  'רפואה ובריאות': 'בריאות',
  'תקשורת ומחשבים': 'תקשורת',
  'ריהוט ובית': 'קניות',
  'ביגוד והנעלה': 'קניות',
  'אופנה': 'קניות',
  'פנאי בילוי': 'בידור',
  'בילוי ופנאי': 'בידור',
  'ספורט': 'בידור',
  'תיירות ונופש': 'נסיעות',
  'חינוך ופנאי': 'חינוך',
  'ביטוח ופיננסים': 'ביטוח ופיננסים',
  'מוסדות': 'אחר',
  'שונות': 'אחר',
  // --- Max taxonomy ---
  'מזון וצריכה': 'מזון',
  'מסעדות, קפה וברים': 'מסעדות',
  'פנאי, בידור וספורט': 'בידור',
  'תחבורה ורכבים': 'תחבורה',
  'ביטוח': 'ביטוח ופיננסים',
  'רפואה ובתי מרקחת': 'בריאות',
  'עיצוב הבית': 'קניות',
  'דלק, חשמל וגז': 'רכב',
  'חשמל ומחשבים': 'תקשורת',
  'שירותי תקשורת': 'תקשורת',
  'העברת כספים': 'העברות',
  'קוסמטיקה וטיפוח': 'קניות',
  'ספרים ודפוס': 'חינוך',
  'חיות מחמד': 'קניות',
  'טיסות ותיירות': 'נסיעות',
  'עירייה וממשלה': 'חשבונות בית',
}

/** Normalize a single category value to its canonical Hebrew form. */
export function normalizeCategory(value) {
  if (!value) return OTHER_CATEGORY
  return CATEGORY_NORMALIZE[value] || value
}

/**
 * One-time-ish migration: rewrite every stored category value (in transactions
 * and in category_rules) to its canonical Hebrew form. Idempotent — once values
 * are canonical, nothing changes on subsequent runs.
 */
export function migrateCategoriesToHebrew(db = getDb()) {
  let changed = 0
  db.exec('BEGIN')
  try {
    for (const table of ['transactions', 'category_rules', 'budgets']) {
      const cats = db.prepare(`SELECT DISTINCT category FROM ${table}`).all()
      const upd = db.prepare(`UPDATE ${table} SET category = ? WHERE category = ?`)
      for (const { category } of cats) {
        const next = normalizeCategory(category)
        if (next !== category) changed += upd.run(next, category).changes
      }
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  return changed
}

/**
 * Load all rules from the DB, ordered so the highest-priority rule is first.
 * Returns array of { keyword (lowercased), category, priority }.
 */
export function loadRules(db = getDb()) {
  return db.prepare(
    `SELECT keyword, category, priority FROM category_rules
     ORDER BY priority DESC, length(keyword) DESC, id ASC`
  ).all().map(r => ({
    keyword: (r.keyword || '').toLowerCase(),
    category: r.category,
    priority: r.priority,
  }))
}

/**
 * Find the category for a description given a pre-loaded, pre-sorted rules array.
 * Returns the matching category, or null if nothing matches.
 *
 * Longer keywords are tried before shorter ones (within the same priority) so a
 * specific match like "rami levy" wins over a generic one — see loadRules order.
 */
export function categorizeDescription(description, rules) {
  const desc = (description || '').toLowerCase()
  if (!desc) return null
  for (const rule of rules) {
    if (rule.keyword && desc.includes(rule.keyword)) return rule.category
  }
  return null
}

/**
 * Like categorizeDescription, but returns the full winning rule object
 * ({ keyword, category, priority }) instead of just the category, so the caller
 * can tell whether the match is authoritative. Returns null if nothing matches.
 */
export function matchRule(description, rules) {
  const desc = (description || '').toLowerCase()
  if (!desc) return null
  for (const rule of rules) {
    if (rule.keyword && desc.includes(rule.keyword)) return rule
  }
  return null
}

/**
 * Seed the default rule set, but ONLY if the table is empty. This runs on every
 * server start; once rules exist (seeded or user-created) it does nothing, so it
 * never overwrites the user's own rules.
 */
export function seedDefaultRules(db = getDb()) {
  const count = db.prepare(`SELECT COUNT(*) AS c FROM category_rules`).get().c
  if (count > 0) return 0
  const stmt = db.prepare(
    `INSERT INTO category_rules (keyword, category, priority) VALUES (?, ?, ?)`
  )
  db.exec('BEGIN')
  try {
    for (const [keyword, category] of DEFAULT_RULES) stmt.run(keyword, normalizeCategory(category), 0)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  return DEFAULT_RULES.length
}

/**
 * Ensure the curated ESSENTIAL_RULES exist as authoritative rules, and apply each
 * to existing transactions the first time it is added. Idempotent: a rule that is
 * already present is left untouched (so it won't keep fighting later manual edits).
 *
 * Returns { added, applied } — how many rules were newly inserted and how many
 * existing transactions were moved as a result.
 */
export function ensureEssentialRules(db = getDb()) {
  const find = db.prepare(
    `SELECT id, priority FROM category_rules WHERE keyword = ? AND category = ? LIMIT 1`
  )
  const insert = db.prepare(
    `INSERT INTO category_rules (keyword, category, priority) VALUES (?, ?, ?)`
  )
  const bump = db.prepare(`UPDATE category_rules SET priority = ? WHERE id = ?`)
  let added = 0, applied = 0
  for (const [keyword, category] of ESSENTIAL_RULES) {
    const existing = find.get(keyword, category)
    // Already an authoritative rule → nothing to do (don't re-apply over later edits).
    if (existing && existing.priority >= AUTHORITATIVE_PRIORITY) continue
    if (existing) bump.run(AUTHORITATIVE_PRIORITY, existing.id)  // upgrade a weak default
    else insert.run(keyword, category, AUTHORITATIVE_PRIORITY)
    added++
    // Apply once, exactly when the rule first becomes authoritative.
    applied += applyKeywordToAll(db, keyword, category)
  }
  return { added, applied }
}

/**
 * Apply a single new rule to existing UNCATEGORIZED ('אחר') transactions whose
 * description contains the keyword. Used right after a rule is added so the user
 * sees an immediate effect, without overriding categories already set manually
 * or by another rule. Returns the number of transactions updated.
 */
export function applyRuleToUncategorized(db, keyword, category) {
  if (!keyword) return 0
  // LIKE is case-insensitive for ASCII in SQLite, and Hebrew has no case, so a
  // plain substring match works for both. Escape LIKE wildcards in the keyword.
  const safe = String(keyword).replace(/[\\%_]/g, ch => '\\' + ch)
  return db.prepare(
    `UPDATE transactions SET category = ?, updated_at = datetime('now')
     WHERE category = ? AND description LIKE ? ESCAPE '\\'`
  ).run(category, OTHER_CATEGORY, `%${safe}%`).changes
}

/**
 * Force-assign a category to EVERY existing transaction whose description matches
 * the keyword, regardless of its current category. Used when the user wants a
 * keyword rule to also pull in already-categorized transactions (e.g. moving
 * garage/insurance charges into a "רכב" category). Returns rows updated.
 */
export function applyKeywordToAll(db, keyword, category) {
  if (!keyword) return 0
  const safe = String(keyword).replace(/[\\%_]/g, ch => '\\' + ch)
  return db.prepare(
    `UPDATE transactions SET category = ?, updated_at = datetime('now')
     WHERE category != ? AND description LIKE ? ESCAPE '\\'`
  ).run(category, category, `%${safe}%`).changes
}

/**
 * Apply the current rules to existing transactions.
 *
 * @param {object}  db
 * @param {object}  [opts]
 * @param {boolean} [opts.onlyOther=true] - when true, only re-categorize rows
 *        that are currently 'Other' or empty, so manual choices are preserved.
 *        When false, re-categorize every transaction that a rule matches.
 * @returns {object} { updated, scanned }
 */
export function recategorizeAll(db = getDb(), { onlyOther = true } = {}) {
  const rules = loadRules(db)
  const rows = db.prepare(
    `SELECT id, description, category FROM transactions`
  ).all()

  const update = db.prepare(
    `UPDATE transactions SET category = ?, updated_at = datetime('now') WHERE id = ?`
  )

  let updated = 0
  db.exec('BEGIN')
  try {
    for (const row of rows) {
      const current = row.category || OTHER_CATEGORY
      if (onlyOther && current !== OTHER_CATEGORY) continue
      const next = categorizeDescription(row.description, rules)
      if (next && next !== current) {
        update.run(next, row.id)
        updated++
      }
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  return { updated, scanned: rows.length }
}
