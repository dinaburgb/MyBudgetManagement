/**
 * Tests for transaction deduplication and saving logic.
 * Uses an in-memory SQLite DB and fake transactions — no real credentials needed.
 *
 * Run with:  node tests/test_save_transactions.js
 */

import { DatabaseSync } from 'node:sqlite'
import assert from 'node:assert'
import { SCHEMA_SQL } from '../server/db/schema.js'
import { saveAccountTransactions } from '../server/db/save-transactions.js'

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS  ${name}`) }
  catch (e) { failed++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

const account = { id: 1, name: 'Discount — Boris', source: 'discount', owner: 'Boris' }

function freshDb() {
  const db = new DatabaseSync(':memory:')
  db.exec(SCHEMA_SQL)
  // Insert the account row so transactions' foreign key is satisfied
  db.prepare(`INSERT INTO accounts (id, name, source, owner, credentials) VALUES (?, ?, ?, ?, ?)`)
    .run(account.id, account.name, account.source, account.owner, 'x')
  return db
}

function txn(over = {}) {
  return {
    type: 'normal',
    identifier: over.identifier,
    date: '2026-06-01T00:00:00.000Z',
    processedDate: '2026-06-01T00:00:00.000Z',
    originalAmount: -100,
    originalCurrency: 'ILS',
    chargedAmount: -100,
    chargedCurrency: 'ILS',
    description: 'SUPERMARKET TEL AVIV',
    status: 'completed',
    ...over,
  }
}

console.log('\nTransaction save & dedup tests:')

test('inserts new transactions', () => {
  const db = freshDb()
  const stats = saveAccountTransactions(account,
    { accountNumber: '123', txns: [txn({ identifier: 'A1' }), txn({ identifier: 'A2', description: 'CAFE' })] },
    db)
  assert.strictEqual(stats.inserted, 2)
  const count = db.prepare('SELECT COUNT(*) c FROM transactions').get().c
  assert.strictEqual(count, 2)
})

test('skips duplicates on second run (by identifier)', () => {
  const db = freshDb()
  const data = { accountNumber: '123', txns: [txn({ identifier: 'A1' })] }
  saveAccountTransactions(account, data, db)
  const stats = saveAccountTransactions(account, data, db)  // run again
  assert.strictEqual(stats.inserted, 0)
  assert.strictEqual(stats.skipped, 1)
  const count = db.prepare('SELECT COUNT(*) c FROM transactions').get().c
  assert.strictEqual(count, 1)  // no duplicate
})

test('dedups by content hash when no identifier', () => {
  const db = freshDb()
  const data = { accountNumber: '123', txns: [txn({ identifier: undefined })] }
  saveAccountTransactions(account, data, db)
  const stats = saveAccountTransactions(account, data, db)
  assert.strictEqual(stats.skipped, 1)
  const count = db.prepare('SELECT COUNT(*) c FROM transactions').get().c
  assert.strictEqual(count, 1)
})

test('pending becomes completed updates same row (no duplicate)', () => {
  const db = freshDb()
  saveAccountTransactions(account,
    { accountNumber: '123', txns: [txn({ identifier: 'P1', status: 'pending' })] }, db)
  const stats = saveAccountTransactions(account,
    { accountNumber: '123', txns: [txn({ identifier: 'P1', status: 'completed' })] }, db)
  assert.strictEqual(stats.updated, 1)
  const rows = db.prepare('SELECT status FROM transactions').all()
  assert.strictEqual(rows.length, 1)            // still one row
  assert.strictEqual(rows[0].status, 'completed')  // now completed
})

test('stores raw payload and installment fields', () => {
  const db = freshDb()
  saveAccountTransactions(account, { accountNumber: '123', txns: [
    txn({ identifier: 'I1', type: 'installments', installments: { number: 2, total: 6 } })
  ] }, db)
  const row = db.prepare('SELECT * FROM transactions').get()
  assert.strictEqual(row.type, 'installment')
  assert.strictEqual(row.installment_number, 2)
  assert.strictEqual(row.installment_total, 6)
  assert.ok(row.raw_payload_json.includes('I1'))  // raw payload kept
})

test('owner and source come from the account', () => {
  const db = freshDb()
  saveAccountTransactions(account, { accountNumber: '123', txns: [txn({ identifier: 'O1' })] }, db)
  const row = db.prepare('SELECT owner, source FROM transactions').get()
  assert.strictEqual(row.owner, 'Boris')
  assert.strictEqual(row.source, 'discount')
})

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
