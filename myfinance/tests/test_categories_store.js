/**
 * Tests for the user-manageable category store (add / rename / delete).
 * In-memory DB. Run with:  node tests/test_categories_store.js
 */

import { DatabaseSync } from 'node:sqlite'
import assert from 'node:assert'
import { SCHEMA_SQL } from '../server/db/schema.js'
import { saveAccountTransactions } from '../server/db/save-transactions.js'
import {
  seedCategories, listCategoryNames, addCategory, updateCategory, deleteCategory,
  listCategories, incomeCategoryNames, excludedCategoryNames,
} from '../server/db/categories.js'

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS  ${name}`) }
  catch (e) { failed++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

const account = { id: 1, name: 'Cal', source: 'cal', owner: 'Boris' }
function txn(over = {}) {
  return {
    type: 'normal', date: '2026-06-01T00:00:00.000Z', processedDate: '2026-06-01T00:00:00.000Z',
    originalAmount: -100, originalCurrency: 'ILS', chargedAmount: -100, chargedCurrency: 'ILS',
    description: 'x', status: 'completed', ...over,
  }
}
function freshDb() {
  const db = new DatabaseSync(':memory:')
  db.exec(SCHEMA_SQL)
  db.prepare(`INSERT INTO accounts (id,name,source,owner,credentials,include_in_totals) VALUES (1,'Cal','cal','Boris','x',1)`).run()
  seedCategories(db)
  return db
}
const catId = (db, name) => db.prepare(`SELECT id FROM categories WHERE name = ?`).get(name).id

console.log('\nCategory store tests:')

test('seedCategories seeds the canonical set with אחר as system', () => {
  const db = freshDb()
  const names = listCategoryNames(db)
  assert.ok(names.includes('מזון'))
  assert.ok(names.includes('אחר'))
  const other = db.prepare(`SELECT is_system FROM categories WHERE name='אחר'`).get()
  assert.strictEqual(other.is_system, 1)
  // idempotent
  assert.strictEqual(seedCategories(db), 0)
})

test('addCategory adds a custom category and rejects duplicates', () => {
  const db = freshDb()
  addCategory(db, 'מתנות', '#ff0000')
  assert.ok(listCategoryNames(db).includes('מתנות'))
  assert.throws(() => addCategory(db, 'מתנות'), e => e.code === 'EXISTS')
  assert.throws(() => addCategory(db, '   '),   e => e.code === 'INVALID')
})

test('rename propagates to transactions, rules and budgets', () => {
  const db = freshDb()
  saveAccountTransactions(account, { accountNumber: '1', txns: [txn({ category: 'מזון' })] }, db)
  db.prepare(`INSERT INTO category_rules (keyword,category,priority) VALUES ('rami','מזון',0)`).run()
  db.prepare(`INSERT INTO budgets (category,month,amount) VALUES ('מזון','',3000)`).run()

  updateCategory(db, catId(db, 'מזון'), { name: 'מצרכים' })

  assert.strictEqual(db.prepare(`SELECT category FROM transactions`).get().category, 'מצרכים')
  assert.strictEqual(db.prepare(`SELECT category FROM category_rules`).get().category, 'מצרכים')
  assert.strictEqual(db.prepare(`SELECT category FROM budgets`).get().category, 'מצרכים')
  assert.ok(listCategoryNames(db).includes('מצרכים'))
  assert.ok(!listCategoryNames(db).includes('מזון'))
})

test('rename to an existing name is rejected', () => {
  const db = freshDb()
  assert.throws(() => updateCategory(db, catId(db, 'מזון'), { name: 'רכב' }), e => e.code === 'EXISTS')
})

test('delete reassigns transactions/rules to אחר and drops its budgets', () => {
  const db = freshDb()
  saveAccountTransactions(account, { accountNumber: '1', txns: [txn({ category: 'בידור' })] }, db)
  db.prepare(`INSERT INTO category_rules (keyword,category,priority) VALUES ('steam','בידור',0)`).run()
  db.prepare(`INSERT INTO budgets (category,month,amount) VALUES ('בידור','',200)`).run()

  deleteCategory(db, catId(db, 'בידור'))

  assert.strictEqual(db.prepare(`SELECT category FROM transactions`).get().category, 'אחר')
  assert.strictEqual(db.prepare(`SELECT category FROM category_rules`).get().category, 'אחר')
  assert.strictEqual(db.prepare(`SELECT COUNT(*) c FROM budgets WHERE category='בידור'`).get().c, 0)
  assert.ok(!listCategoryNames(db).includes('בידור'))
})

test('delete with a target moves data to that category, not אחר', () => {
  const db = freshDb()
  saveAccountTransactions(account, { accountNumber: '1', txns: [txn({ category: 'בידור' })] }, db)
  db.prepare(`INSERT INTO category_rules (keyword,category,priority) VALUES ('steam','בידור',0)`).run()

  const res = deleteCategory(db, catId(db, 'בידור'), 'תקשורת')

  assert.strictEqual(res.dest, 'תקשורת')
  assert.strictEqual(db.prepare(`SELECT category FROM transactions`).get().category, 'תקשורת')
  assert.strictEqual(db.prepare(`SELECT category FROM category_rules`).get().category, 'תקשורת')
  assert.ok(!listCategoryNames(db).includes('בידור'))
})

test('delete with an unknown / empty target falls back to אחר', () => {
  const db = freshDb()
  saveAccountTransactions(account, { accountNumber: '1', txns: [txn({ category: 'בידור' })] }, db)
  const res = deleteCategory(db, catId(db, 'בידור'), 'קטגוריה שלא קיימת')
  assert.strictEqual(res.dest, 'אחר')
  assert.strictEqual(db.prepare(`SELECT category FROM transactions`).get().category, 'אחר')
})

test('is_excluded flag is settable, listed, and survives a rename', () => {
  const db = freshDb()
  assert.ok(!excludedCategoryNames(db).includes('קניות'))
  updateCategory(db, catId(db, 'קניות'), { is_excluded: true })
  assert.strictEqual(listCategories(db).find(c => c.name === 'קניות').is_excluded, 1)
  assert.ok(excludedCategoryNames(db).includes('קניות'))
  updateCategory(db, catId(db, 'קניות'), { name: 'רכישות' })
  assert.ok(excludedCategoryNames(db).includes('רכישות'))
})

test('system category אחר cannot be deleted', () => {
  const db = freshDb()
  assert.throws(() => deleteCategory(db, catId(db, 'אחר')), e => e.code === 'SYSTEM')
})

test('is_income flag is settable, listed, and rename keeps it', () => {
  const db = freshDb()
  addCategory(db, 'הכנסות', '#22c55e')
  // default not income
  assert.ok(!incomeCategoryNames(db).includes('הכנסות'))
  updateCategory(db, catId(db, 'הכנסות'), { is_income: true })
  assert.ok(incomeCategoryNames(db).includes('הכנסות'))
  assert.strictEqual(listCategories(db).find(c => c.name === 'הכנסות').is_income, 1)
  // rename preserves the income flag
  updateCategory(db, catId(db, 'הכנסות'), { name: 'משכורת' })
  assert.ok(incomeCategoryNames(db).includes('משכורת'))
  // can be turned back off
  updateCategory(db, catId(db, 'משכורת'), { is_income: false })
  assert.ok(!incomeCategoryNames(db).includes('משכורת'))
})

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
