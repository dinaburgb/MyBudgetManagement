/**
 * Tests for the auto-categorization engine.
 * Uses an in-memory SQLite DB — no real data or credentials needed.
 *
 * Run with:  node tests/test_categorize.js
 */

import { DatabaseSync } from 'node:sqlite'
import assert from 'node:assert'
import { SCHEMA_SQL } from '../server/db/schema.js'
import {
  loadRules, categorizeDescription, seedDefaultRules, recategorizeAll, DEFAULT_RULES,
  normalizeCategory, migrateCategoriesToHebrew, OTHER_CATEGORY,
  applyRuleToUncategorized, applyKeywordToAll,
} from '../server/db/categorize.js'
import { saveAccountTransactions } from '../server/db/save-transactions.js'

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS  ${name}`) }
  catch (e) { failed++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

const account = { id: 1, name: 'Cal — Boris', source: 'cal', owner: 'Boris' }

function freshDb() {
  const db = new DatabaseSync(':memory:')
  db.exec(SCHEMA_SQL)
  db.prepare(`INSERT INTO accounts (id, name, source, owner, credentials) VALUES (?, ?, ?, ?, ?)`)
    .run(account.id, account.name, account.source, account.owner, 'x')
  return db
}

function addRule(db, keyword, category, priority = 0) {
  db.prepare(`INSERT INTO category_rules (keyword, category, priority) VALUES (?, ?, ?)`)
    .run(keyword, category, priority)
}

function txn(over = {}) {
  return {
    type: 'normal', date: '2026-06-01T00:00:00.000Z', processedDate: '2026-06-01T00:00:00.000Z',
    originalAmount: -100, originalCurrency: 'ILS', chargedAmount: -100, chargedCurrency: 'ILS',
    description: '', status: 'completed', ...over,
  }
}

console.log('\nCategorization tests:')

test('matches a keyword as a case-insensitive substring (Hebrew)', () => {
  const db = freshDb()
  addRule(db, 'שופרסל', 'Groceries')
  const rules = loadRules(db)
  assert.strictEqual(categorizeDescription('שופרסל דיל רמת גן', rules), 'Groceries')
})

test('matches English keyword regardless of case', () => {
  const db = freshDb()
  addRule(db, 'netflix', 'Entertainment')
  const rules = loadRules(db)
  assert.strictEqual(categorizeDescription('NETFLIX.COM', rules), 'Entertainment')
})

test('returns null when nothing matches', () => {
  const db = freshDb()
  addRule(db, 'paz', 'Fuel')
  const rules = loadRules(db)
  assert.strictEqual(categorizeDescription('some random shop', rules), null)
})

test('higher priority rule wins over lower priority', () => {
  const db = freshDb()
  addRule(db, 'market', 'Groceries', 0)
  addRule(db, 'super market', 'Shopping', 10)
  const rules = loadRules(db)
  assert.strictEqual(categorizeDescription('THE SUPER MARKET', rules), 'Shopping')
})

test('within same priority, longer keyword wins', () => {
  const db = freshDb()
  addRule(db, 'rami', 'Other', 0)
  addRule(db, 'rami levy', 'Groceries', 0)
  const rules = loadRules(db)
  assert.strictEqual(categorizeDescription('RAMI LEVY HASHIKMA', rules), 'Groceries')
})

test('seedDefaultRules populates an empty table, and is a no-op afterwards', () => {
  const db = freshDb()
  const n = seedDefaultRules(db)
  assert.strictEqual(n, DEFAULT_RULES.length)
  const again = seedDefaultRules(db)
  assert.strictEqual(again, 0)  // does not double-seed
  const count = db.prepare('SELECT COUNT(*) c FROM category_rules').get().c
  assert.strictEqual(count, DEFAULT_RULES.length)
})

test('new transactions are auto-categorized on import (Hebrew)', () => {
  const db = freshDb()
  seedDefaultRules(db)
  saveAccountTransactions(account, { accountNumber: '7364', txns: [
    txn({ description: 'שופרסל דיל' }),
    txn({ description: 'PAZ FUEL STATION', chargedAmount: -250 }),
    txn({ description: 'totally unknown merchant', chargedAmount: -40 }),
  ] }, db)
  const rows = db.prepare('SELECT description, category FROM transactions ORDER BY id').all()
  assert.strictEqual(rows[0].category, 'מזון')
  assert.strictEqual(rows[1].category, 'רכב')   // fuel folds into vehicle (רכב)
  assert.strictEqual(rows[2].category, 'אחר')  // no match → Other
})

test('scraper Hebrew category is normalized to our canonical set', () => {
  const db = freshDb()
  saveAccountTransactions(account, { accountNumber: '7364', txns: [
    txn({ description: 'whatever', category: 'מזון ומשקאות' }),     // Cal taxonomy
    txn({ description: 'whatever2', category: 'תקשורת ומחשבים', chargedAmount: -50 }),
  ] }, db)
  const rows = db.prepare('SELECT category FROM transactions ORDER BY id').all()
  assert.strictEqual(rows[0].category, 'מזון')
  assert.strictEqual(rows[1].category, 'תקשורת')
})

test('scraper-provided category is not overridden by rules', () => {
  const db = freshDb()
  seedDefaultRules(db)
  saveAccountTransactions(account, { accountNumber: '7364', txns: [
    txn({ description: 'שופרסל', category: 'MyCustomCategory' }),
  ] }, db)
  const row = db.prepare('SELECT category FROM transactions').get()
  assert.strictEqual(row.category, 'MyCustomCategory')
})

test('recategorize (other mode) only touches Other rows', () => {
  const db = freshDb()
  // Import with no rules → everything lands as 'Other'
  saveAccountTransactions(account, { accountNumber: '7364', txns: [
    txn({ description: 'שופרסל' }),
    txn({ description: 'PAZ', chargedAmount: -250 }),
  ] }, db)
  // Manually set one to a real category
  db.prepare(`UPDATE transactions SET category = 'Shopping' WHERE description = 'PAZ'`).run()
  // Now add rules and recategorize only the uncategorized
  seedDefaultRules(db)
  const res = recategorizeAll(db, { onlyOther: true })
  assert.strictEqual(res.updated, 1)  // only שופרסל changed; PAZ kept manual 'Shopping'
  const paz = db.prepare(`SELECT category FROM transactions WHERE description = 'PAZ'`).get()
  assert.strictEqual(paz.category, 'Shopping')
  const shufersal = db.prepare(`SELECT category FROM transactions WHERE description = 'שופרסל'`).get()
  assert.strictEqual(shufersal.category, 'מזון')
})

test('recategorize (all mode) re-evaluates manually-set rows too', () => {
  const db = freshDb()
  saveAccountTransactions(account, { accountNumber: '7364', txns: [txn({ description: 'שופרסל' })] }, db)
  db.prepare(`UPDATE transactions SET category = 'Shopping'`).run()
  seedDefaultRules(db)
  const res = recategorizeAll(db, { onlyOther: false })
  assert.strictEqual(res.updated, 1)
  const row = db.prepare('SELECT category FROM transactions').get()
  assert.strictEqual(row.category, 'מזון')
})

test('normalizeCategory folds English and Cal taxonomies into canonical Hebrew', () => {
  assert.strictEqual(normalizeCategory('Groceries'), 'מזון')
  assert.strictEqual(normalizeCategory('מזון ומשקאות'), 'מזון')
  assert.strictEqual(normalizeCategory('אנרגיה'), 'רכב')   // fuel → vehicle
  assert.strictEqual(normalizeCategory('דלק'), 'רכב')      // legacy fuel category → vehicle
  // Max taxonomy folds in too
  assert.strictEqual(normalizeCategory('מזון וצריכה'), 'מזון')
  assert.strictEqual(normalizeCategory('פנאי, בידור וספורט'), 'בידור')
  assert.strictEqual(normalizeCategory('תחבורה ורכבים'), 'תחבורה')
  assert.strictEqual(normalizeCategory('שונות'), 'אחר')
  assert.strictEqual(normalizeCategory('מזון'), 'מזון')        // already canonical → unchanged
  assert.strictEqual(normalizeCategory(null), OTHER_CATEGORY)  // empty → Other
  assert.strictEqual(normalizeCategory('משהו ייחודי'), 'משהו ייחודי')  // unknown passes through
})

test('migrateCategoriesToHebrew converts existing rows and is idempotent', () => {
  const db = freshDb()
  // Seed legacy-style data: English on transactions, Cal-Hebrew on a rule
  saveAccountTransactions(account, { accountNumber: '7364', txns: [txn({ description: 'x' })] }, db)
  db.prepare(`UPDATE transactions SET category = 'Groceries'`).run()
  db.prepare(`INSERT INTO category_rules (keyword, category, priority) VALUES ('paz','אנרגיה',0)`).run()

  const changed = migrateCategoriesToHebrew(db)
  assert.ok(changed >= 2)
  assert.strictEqual(db.prepare('SELECT category FROM transactions').get().category, 'מזון')
  assert.strictEqual(db.prepare('SELECT category FROM category_rules').get().category, 'רכב')

  const again = migrateCategoriesToHebrew(db)
  assert.strictEqual(again, 0)  // idempotent
})

test('applyRuleToUncategorized categorizes matching אחר rows only', () => {
  const db = freshDb()
  // two uncategorized + one already categorized, all matching "רב קו"
  saveAccountTransactions(account, { accountNumber: '1', txns: [
    txn({ description: 'רב קו תל אביב' }),
    txn({ description: 'טעינת רב קו', chargedAmount: -50 }),
    txn({ description: 'רב קו אחר', chargedAmount: -20, category: 'תחבורה' }),  // already set
  ] }, db)
  const n = applyRuleToUncategorized(db, 'רב קו', 'תחבורה')
  assert.strictEqual(n, 2)  // only the two אחר rows moved; the pre-set one untouched
  const cats = db.prepare(`SELECT COUNT(*) c FROM transactions WHERE category='תחבורה'`).get().c
  assert.strictEqual(cats, 3)
})

test('applyKeywordToAll overrides already-categorized matching rows', () => {
  const db = freshDb()
  saveAccountTransactions(account, { accountNumber: '1', txns: [
    txn({ description: 'פריים מוטורס מוסך', category: 'תחבורה' }),     // already categorized
    txn({ description: 'מוסך הצפון', chargedAmount: -300 }),            // אחר
    txn({ description: 'סופרמרקט', chargedAmount: -80 }),               // unrelated
  ] }, db)
  const n = applyKeywordToAll(db, 'מוסך', 'רכב')
  assert.strictEqual(n, 2)  // both מוסך rows moved, including the one set to תחבורה
  assert.strictEqual(db.prepare(`SELECT COUNT(*) c FROM transactions WHERE category='רכב'`).get().c, 2)
})

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
