/**
 * Tests for transaction deduplication and saving logic.
 * Uses an in-memory SQLite DB and fake transactions — no real credentials needed.
 *
 * Run with:  node tests/test_save_transactions.js
 */

import { DatabaseSync } from 'node:sqlite'
import assert from 'node:assert'
import { SCHEMA_SQL } from '../server/db/schema.js'
import { saveAccountTransactions, insertManualTransaction } from '../server/db/save-transactions.js'

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS  ${name}`) }
  catch (e) { failed++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

const account = { id: 1, name: 'Discount — Me', source: 'discount', owner: 'Me' }

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

test('insertManualTransaction adds a cash expense (no account)', () => {
  const db = freshDb()
  const id = insertManualTransaction(db, {
    date: '2026-06-12', description: 'קנייה בשוק', amount: -80, category: 'מזון', owner: 'Me',
  })
  const row = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id)
  assert.strictEqual(row.source, 'manual')
  assert.strictEqual(row.amount, -80)
  assert.strictEqual(row.category, 'מזון')
  assert.strictEqual(row.account_id, null)
  assert.strictEqual(row.account_name, 'מזומן')   // cash default
  assert.ok(String(row.dedup_key).startsWith('manual:'))
})

test('two identical manual entries are both kept (random dedup key)', () => {
  const db = freshDb()
  insertManualTransaction(db, { date: '2026-06-12', description: 'x', amount: -10 })
  insertManualTransaction(db, { date: '2026-06-12', description: 'x', amount: -10 })
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM transactions').get().c, 2)
})

test('manual entry can be attached to an account', () => {
  const db = freshDb()
  const id = insertManualTransaction(db, {
    date: '2026-06-12', description: 'הפקדה', amount: 500, owner: 'Partner',
    account_id: 1, account_name: 'Discount — Me',
  })
  const row = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id)
  assert.strictEqual(row.account_id, 1)
  assert.strictEqual(row.amount, 500)
})

test('inserts new transactions', () => {
  const db = freshDb()
  const stats = saveAccountTransactions(account,
    { accountNumber: '123', txns: [txn({ identifier: 'A1' }), txn({ identifier: 'A2', description: 'CAFE' })] },
    db)
  assert.strictEqual(stats.inserted, 2)
  const count = db.prepare('SELECT COUNT(*) c FROM transactions').get().c
  assert.strictEqual(count, 2)
})

test('skips duplicates on second run (same content)', () => {
  const db = freshDb()
  const data = { accountNumber: '123', txns: [txn({ identifier: 'A1' })] }
  saveAccountTransactions(account, data, db)
  const stats = saveAccountTransactions(account, data, db)  // run again
  assert.strictEqual(stats.inserted, 0)
  assert.strictEqual(stats.skipped, 1)
  const count = db.prepare('SELECT COUNT(*) c FROM transactions').get().c
  assert.strictEqual(count, 1)  // no duplicate
})

test('recurring payments sharing a bank id are kept separate (FIBI bug)', () => {
  // FIBI reuses the same "reference" for every payment to the same payee.
  // Different date+amount means different real transactions — keep them all.
  const db = freshDb()
  const stats = saveAccountTransactions(account, { accountNumber: '123', txns: [
    txn({ identifier: '64280', date: '2026-04-30T00:00:00.000Z', chargedAmount: 1609.35, description: 'Harel pension' }),
    txn({ identifier: '64280', date: '2026-05-31T00:00:00.000Z', chargedAmount: 1608.61, description: 'Harel pension' }),
    txn({ identifier: '64280', date: '2026-06-30T00:00:00.000Z', chargedAmount: 1610.00, description: 'Harel pension' }),
  ] }, db)
  assert.strictEqual(stats.inserted, 3)
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM transactions').get().c, 3)
})

test('truly identical transactions in one import are both kept (occurrence index)', () => {
  const db = freshDb()
  const stats = saveAccountTransactions(account, { accountNumber: '123', txns: [
    txn({ identifier: undefined, date: '2026-06-01T00:00:00.000Z', chargedAmount: -20, description: 'BUS' }),
    txn({ identifier: undefined, date: '2026-06-01T00:00:00.000Z', chargedAmount: -20, description: 'BUS' }),
  ] }, db)
  assert.strictEqual(stats.inserted, 2)  // two identical bus rides — keep both
  // Re-import the same two — should dedup, not duplicate
  const again = saveAccountTransactions(account, { accountNumber: '123', txns: [
    txn({ identifier: undefined, date: '2026-06-01T00:00:00.000Z', chargedAmount: -20, description: 'BUS' }),
    txn({ identifier: undefined, date: '2026-06-01T00:00:00.000Z', chargedAmount: -20, description: 'BUS' }),
  ] }, db)
  assert.strictEqual(again.inserted, 0)
  assert.strictEqual(again.skipped, 2)
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM transactions').get().c, 2)
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

test('zero-amount pending holds (Max pre-auth) are skipped, real charge kept', () => {
  const db = freshDb()
  const stats = saveAccountTransactions(account, { accountNumber: '8927', txns: [
    // Max pre-authorization hold: pending, amount 0, no identifier — should be dropped.
    txn({ identifier: undefined, status: 'pending', date: '2026-06-12T00:00:00.000Z',
          originalAmount: 0, chargedAmount: 0, description: 'מעדנית אברהמי' }),
    // The real settled charge for the same purchase — must be kept.
    txn({ identifier: 'R1', status: 'completed', date: '2026-06-11T00:00:00.000Z',
          originalAmount: -94.3, chargedAmount: -94.3, description: 'מעדנית אברהמי' }),
  ] }, db)
  assert.strictEqual(stats.inserted, 1)
  assert.strictEqual(stats.skipped, 1)
  const rows = db.prepare('SELECT amount, status FROM transactions').all()
  assert.strictEqual(rows.length, 1)
  assert.strictEqual(rows[0].amount, -94.3)
  assert.strictEqual(rows[0].status, 'completed')
})

test('a non-zero pending charge is still kept (real upcoming charge)', () => {
  const db = freshDb()
  const stats = saveAccountTransactions(account, { accountNumber: '123', txns: [
    txn({ identifier: 'U1', status: 'pending', chargedAmount: -50, description: 'GAS' }),
  ] }, db)
  assert.strictEqual(stats.inserted, 1)
  assert.strictEqual(stats.skipped, 0)
})

test('a non-zero pending hold is removed once it settles as a different charge', () => {
  const db = freshDb()
  // A ₪300 fuel pre-authorization hold (pending), no identifier.
  saveAccountTransactions(account, { accountNumber: '123', txns: [
    txn({ status: 'pending', date: '2026-06-13T00:00:00.000Z', chargedAmount: -300, description: 'פז יילו' }),
  ] }, db)
  // Next scrape: the real charge settled for a different amount/date and the hold
  // is no longer reported.
  const stats = saveAccountTransactions(account, { accountNumber: '123', txns: [
    txn({ status: 'completed', date: '2026-06-12T00:00:00.000Z', chargedAmount: -247, description: 'פז יילו' }),
  ] }, db)
  assert.strictEqual(stats.inserted, 1)
  assert.strictEqual(stats.removedPending, 1)        // stale hold cleaned up
  const rows = db.prepare('SELECT amount, status FROM transactions').all()
  assert.strictEqual(rows.length, 1)
  assert.strictEqual(rows[0].amount, -247)
  assert.strictEqual(rows[0].status, 'completed')
})

test('a pending row still reported on the next scrape is kept', () => {
  const db = freshDb()
  const data = { accountNumber: '123', txns: [
    txn({ status: 'pending', date: '2026-06-13T00:00:00.000Z', chargedAmount: -300, description: 'פז יילו' }),
  ] }
  saveAccountTransactions(account, data, db)
  const stats = saveAccountTransactions(account, data, db)   // same hold, still pending
  assert.strictEqual(stats.removedPending, 0)
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM transactions').get().c, 1)
})

test('an empty scrape result does not delete existing pending rows', () => {
  const db = freshDb()
  saveAccountTransactions(account, { accountNumber: '123', txns: [
    txn({ status: 'pending', chargedAmount: -50, description: 'GAS' }),
  ] }, db)
  const stats = saveAccountTransactions(account, { accountNumber: '123', txns: [] }, db)
  assert.strictEqual(stats.removedPending, 0)
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM transactions').get().c, 1)
})

test('pending reconciliation is scoped to the account/sub-account', () => {
  const db = freshDb()
  // Hold on sub-account 123…
  saveAccountTransactions(account, { accountNumber: '123', txns: [
    txn({ status: 'pending', date: '2026-06-13T00:00:00.000Z', chargedAmount: -300, description: 'פז יילו' }),
  ] }, db)
  // …a scrape of a DIFFERENT sub-account must not touch it.
  const stats = saveAccountTransactions(account, { accountNumber: '999', txns: [
    txn({ status: 'completed', date: '2026-06-13T00:00:00.000Z', chargedAmount: -10, description: 'OTHER' }),
  ] }, db)
  assert.strictEqual(stats.removedPending, 0)
  assert.strictEqual(db.prepare(`SELECT COUNT(*) c FROM transactions WHERE account_number='123'`).get().c, 1)
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
  assert.strictEqual(row.owner, 'Me')
  assert.strictEqual(row.source, 'discount')
})

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
