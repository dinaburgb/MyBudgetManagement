/**
 * Tests for bulk category assignment and the category_manual protection flag.
 *
 * category_manual = 1 marks a category the user set by hand (single edit or the
 * checkbox bulk edit). Rules, re-categorization passes and keyword application
 * must never overwrite such rows.
 *
 * Uses an in-memory SQLite DB — no real data or credentials needed.
 *
 * Run with:  node tests/test_bulk_category.js
 */

import { DatabaseSync } from 'node:sqlite'
import assert from 'node:assert'
import { SCHEMA_SQL } from '../server/db/schema.js'
import {
  bulkSetCategory, applyKeywordToAll, applyRuleToUncategorized,
  recategorizeAll, OTHER_CATEGORY,
} from '../server/db/categorize.js'

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS  ${name}`) }
  catch (e) { failed++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

function freshDb() {
  const db = new DatabaseSync(':memory:')
  db.exec(SCHEMA_SQL)
  return db
}

let seq = 0
function addTxn(db, { description = 'x', category = OTHER_CATEGORY, manual = 0 } = {}) {
  seq++
  db.prepare(`
    INSERT INTO transactions (dedup_key, raw_payload_json, date, amount, description, category, category_manual, source)
    VALUES (?, '{}', '2026-07-01', -100, ?, ?, ?, 'cal')
  `).run(`k${seq}`, description, category, manual)
  return db.prepare(`SELECT last_insert_rowid() AS id`).get().id
}

function getTxn(db, id) {
  return db.prepare(`SELECT category, category_manual FROM transactions WHERE id = ?`).get(id)
}

console.log('\nBulk category + manual-protection tests:')

test('schema includes transactions.category_manual with default 0', () => {
  const db = freshDb()
  const id = addTxn(db)
  assert.strictEqual(getTxn(db, id).category_manual, 0)
})

test('bulkSetCategory updates all given ids and marks them manual', () => {
  const db = freshDb()
  const a = addTxn(db), b = addTxn(db), c = addTxn(db)
  const updated = bulkSetCategory(db, [a, b], 'נסיעות')
  assert.strictEqual(updated, 2)
  for (const id of [a, b]) {
    const row = getTxn(db, id)
    assert.strictEqual(row.category, 'נסיעות')
    assert.strictEqual(row.category_manual, 1)
  }
  assert.strictEqual(getTxn(db, c).category, OTHER_CATEGORY)  // untouched
})

test('bulkSetCategory ignores empty input and bad ids', () => {
  const db = freshDb()
  addTxn(db)
  assert.strictEqual(bulkSetCategory(db, [], 'נסיעות'), 0)
  assert.strictEqual(bulkSetCategory(db, null, 'נסיעות'), 0)
  assert.strictEqual(bulkSetCategory(db, ['abc', -5, 0.5], 'נסיעות'), 0)
  assert.strictEqual(bulkSetCategory(db, [1], ''), 0)
})

test('bulkSetCategory deduplicates repeated ids', () => {
  const db = freshDb()
  const a = addTxn(db)
  const updated = bulkSetCategory(db, [a, a, a], 'נסיעות')
  assert.strictEqual(updated, 1)
})

test('applyKeywordToAll does NOT touch manual rows', () => {
  const db = freshDb()
  const auto   = addTxn(db, { description: 'BOOKING.COM', category: 'קניות' })
  const manual = addTxn(db, { description: 'BOOKING.COM', category: 'קניות', manual: 1 })
  const changed = applyKeywordToAll(db, 'booking', 'נסיעות')
  assert.strictEqual(changed, 1)
  assert.strictEqual(getTxn(db, auto).category, 'נסיעות')
  assert.strictEqual(getTxn(db, manual).category, 'קניות')  // protected
})

test('applyRuleToUncategorized does NOT touch manual rows', () => {
  const db = freshDb()
  const auto   = addTxn(db, { description: 'EL AL', category: OTHER_CATEGORY })
  const manual = addTxn(db, { description: 'EL AL', category: OTHER_CATEGORY, manual: 1 })
  const changed = applyRuleToUncategorized(db, 'el al', 'נסיעות')
  assert.strictEqual(changed, 1)
  assert.strictEqual(getTxn(db, auto).category, 'נסיעות')
  assert.strictEqual(getTxn(db, manual).category, OTHER_CATEGORY)  // protected
})

test('recategorizeAll skips manual rows even in mode all', () => {
  const db = freshDb()
  db.prepare(`INSERT INTO category_rules (keyword, category, priority) VALUES ('airbnb', 'נסיעות', 100)`).run()
  const auto   = addTxn(db, { description: 'AIRBNB PARIS', category: 'קניות' })
  const manual = addTxn(db, { description: 'AIRBNB PARIS', category: 'קניות', manual: 1 })
  recategorizeAll(db, { onlyOther: false })
  assert.strictEqual(getTxn(db, auto).category, 'נסיעות')
  assert.strictEqual(getTxn(db, manual).category, 'קניות')  // protected
})

test('a bulk-assigned row survives a later keyword rule', () => {
  const db = freshDb()
  const id = addTxn(db, { description: 'DUTY FREE SHOP', category: OTHER_CATEGORY })
  bulkSetCategory(db, [id], 'נסיעות')
  applyKeywordToAll(db, 'duty free', 'קניות')
  assert.strictEqual(getTxn(db, id).category, 'נסיעות')  // manual choice wins
})

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
