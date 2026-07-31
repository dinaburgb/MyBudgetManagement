/**
 * Tests for the transactions summary totals (the "sum the selected rows" panel).
 *
 * Sign convention: amount < 0 is an expense, amount > 0 is income.
 *   income  — sum of positive amounts
 *   expense — sum of negative amounts, as a POSITIVE magnitude
 *   net     — income - expense (i.e. the plain signed sum)
 *
 * Uses an in-memory SQLite DB — no real data or credentials needed.
 *
 * Run with:  node tests/test_txn_summary.js
 */

import { DatabaseSync } from 'node:sqlite'
import assert from 'node:assert'
import { SCHEMA_SQL } from '../server/db/schema.js'
import { summarizeTransactions } from '../server/routes/transactions.js'

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
function addTxn(db, { amount = -100, date = '2026-07-01', category = 'אחר',
                      owner = 'Boris', description = 'x' } = {}) {
  seq++
  db.prepare(`
    INSERT INTO transactions (dedup_key, raw_payload_json, date, amount, description,
                              category, owner, source)
    VALUES (?, '{}', ?, ?, ?, ?, ?, 'cal')
  `).run(`k${seq}`, date, amount, description, category, owner)
  return db.prepare(`SELECT last_insert_rowid() AS id`).get().id
}

console.log('\nTransaction summary tests:')

test('empty table returns zeros, not nulls', () => {
  const s = summarizeTransactions(freshDb(), {})
  assert.deepStrictEqual(s, { count: 0, income: 0, expense: 0, net: 0 })
})

test('mixed income and expenses net out correctly', () => {
  const db = freshDb()
  addTxn(db, { amount: -100 })
  addTxn(db, { amount: -250.5 })
  addTxn(db, { amount: 1000 })
  const s = summarizeTransactions(db, {})
  assert.strictEqual(s.count, 3)
  assert.strictEqual(s.income, 1000)
  assert.strictEqual(s.expense, 350.5)
  assert.strictEqual(s.net, 649.5)
})

test('expenses only produce a negative net', () => {
  const db = freshDb()
  addTxn(db, { amount: -40 })
  addTxn(db, { amount: -60 })
  const s = summarizeTransactions(db, {})
  assert.strictEqual(s.income, 0)
  assert.strictEqual(s.expense, 100)
  assert.strictEqual(s.net, -100)
})

test('ids mode sums only the listed rows', () => {
  const db = freshDb()
  const a = addTxn(db, { amount: -100 })
  const b = addTxn(db, { amount: 300 })
  addTxn(db, { amount: -9999 })            // not selected
  const s = summarizeTransactions(db, { ids: `${a},${b}` })
  assert.strictEqual(s.count, 2)
  assert.strictEqual(s.net, 200)
  assert.strictEqual(s.expense, 100)
})

test('ids mode ignores unknown and malformed ids', () => {
  const db = freshDb()
  const a = addTxn(db, { amount: -100 })
  const s = summarizeTransactions(db, { ids: `${a}, 999999, abc,` })
  assert.strictEqual(s.count, 1)
  assert.strictEqual(s.net, -100)
})

test('empty ids list returns zeros (does not fall through to all rows)', () => {
  const db = freshDb()
  addTxn(db, { amount: -5000 })
  const s = summarizeTransactions(db, { ids: '' })
  assert.deepStrictEqual(s, { count: 0, income: 0, expense: 0, net: 0 })
})

test('ids mode handles more than one chunk (>500 ids)', () => {
  const db = freshDb()
  const ids = []
  for (let i = 0; i < 1200; i++) ids.push(addTxn(db, { amount: -1 }))
  const s = summarizeTransactions(db, { ids: ids.join(',') })
  assert.strictEqual(s.count, 1200)
  assert.strictEqual(s.expense, 1200)
  assert.strictEqual(s.net, -1200)
})

test('date range filter narrows the totals', () => {
  const db = freshDb()
  addTxn(db, { amount: -100, date: '2026-06-15' })
  addTxn(db, { amount: -200, date: '2026-07-10' })
  addTxn(db, { amount: -400, date: '2026-08-01' })
  const s = summarizeTransactions(db, { date_from: '2026-07-01', date_to: '2026-07-31' })
  assert.strictEqual(s.count, 1)
  assert.strictEqual(s.net, -200)
})

test('category filter accepts a comma-separated multi-select', () => {
  const db = freshDb()
  addTxn(db, { amount: -100, category: 'מזון' })
  addTxn(db, { amount: -200, category: 'רכב' })
  addTxn(db, { amount: -400, category: 'אחר' })
  const s = summarizeTransactions(db, { category: 'מזון,רכב' })
  assert.strictEqual(s.count, 2)
  assert.strictEqual(s.expense, 300)
})

test('owner filter narrows the totals', () => {
  const db = freshDb()
  addTxn(db, { amount: -100, owner: 'Boris' })
  addTxn(db, { amount: -250, owner: 'Irena' })
  const s = summarizeTransactions(db, { owner: 'Irena' })
  assert.strictEqual(s.count, 1)
  assert.strictEqual(s.net, -250)
})

test('summary matches the sum of the amounts it covers', () => {
  const db = freshDb()
  const amounts = [-12.34, 56.78, -90.1, 1000, -0.99]
  amounts.forEach(a => addTxn(db, { amount: a }))
  const s = summarizeTransactions(db, {})
  const expected = amounts.reduce((t, a) => t + a, 0)
  assert.ok(Math.abs(s.net - expected) < 1e-9, `${s.net} != ${expected}`)
})

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
