/**
 * Tests for account deletion / cleaning.
 * In-memory DB. Run with:  node tests/test_accounts.js
 */

import { DatabaseSync } from 'node:sqlite'
import assert from 'node:assert'
import { SCHEMA_SQL } from '../server/db/schema.js'
import { saveAccountTransactions } from '../server/db/save-transactions.js'
import { upsertBalance } from '../server/db/balances.js'
import { deleteAccount, moveAccount } from '../server/db/accounts.js'

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS  ${name}`) }
  catch (e) { failed++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

const account = { id: 1, name: 'Cal', source: 'cal', owner: 'Me' }

function txn(over = {}) {
  return {
    type: 'normal', date: '2026-06-01T00:00:00.000Z', processedDate: '2026-06-01T00:00:00.000Z',
    originalAmount: -100, originalCurrency: 'ILS', chargedAmount: -100, chargedCurrency: 'ILS',
    description: 'x', status: 'completed', ...over,
  }
}

function seed() {
  const db = new DatabaseSync(':memory:')
  db.exec(SCHEMA_SQL)
  db.prepare(`INSERT INTO accounts (id,name,source,owner,credentials,include_in_totals) VALUES (1,'Cal','cal','Me','x',1)`).run()
  saveAccountTransactions(account, { accountNumber: '7364', txns: [
    txn({ description: 'a', chargedAmount: -100 }),
    txn({ description: 'b', chargedAmount: -50, date: '2026-06-02T00:00:00.000Z' }),
  ] }, db)
  upsertBalance(db, 1, '7364', 0, '2026-06-02T00:00:00Z')
  return db
}

const counts = db => ({
  accounts: db.prepare('SELECT COUNT(*) c FROM accounts').get().c,
  txns:     db.prepare('SELECT COUNT(*) c FROM transactions').get().c,
  balances: db.prepare('SELECT COUNT(*) c FROM account_balances').get().c,
})

console.log('\nAccount delete/clean tests:')

test('delete (account only) keeps transactions but detaches them', () => {
  const db = seed()
  const res = deleteAccount(db, 1, false)
  assert.strictEqual(res.deletedTransactions, 0)
  const c = counts(db)
  assert.strictEqual(c.accounts, 0)   // account gone
  assert.strictEqual(c.txns, 2)       // transactions kept as history
  assert.strictEqual(c.balances, 0)   // balance removed (account-specific)
  // detached: account_id is now NULL on the kept transactions
  const linked = db.prepare('SELECT COUNT(*) c FROM transactions WHERE account_id IS NOT NULL').get().c
  assert.strictEqual(linked, 0)
})

test('clean (withData) removes account, transactions and balances', () => {
  const db = seed()
  const res = deleteAccount(db, 1, true)
  assert.strictEqual(res.deletedTransactions, 2)
  const c = counts(db)
  assert.strictEqual(c.accounts, 0)
  assert.strictEqual(c.txns, 0)
  assert.strictEqual(c.balances, 0)
})

test('clean only affects the targeted account', () => {
  const db = seed()
  // a second account with its own transaction
  db.prepare(`INSERT INTO accounts (id,name,source,owner,credentials,include_in_totals) VALUES (2,'Disc','discount','Partner','x',1)`).run()
  saveAccountTransactions({ id: 2, name: 'Disc', source: 'discount', owner: 'Partner' },
    { accountNumber: '999', txns: [txn({ description: 'z', chargedAmount: -10 })] }, db)
  deleteAccount(db, 1, true)
  const c = counts(db)
  assert.strictEqual(c.accounts, 1)   // account 2 remains
  assert.strictEqual(c.txns, 1)       // its transaction remains
})

// --- Reordering (moveAccount) ---

// Three accounts with sort_order 1,2,3. Returns their ids in display order.
function seedThree() {
  const db = new DatabaseSync(':memory:')
  db.exec(SCHEMA_SQL)
  db.prepare(`INSERT INTO accounts (id,name,source,owner,credentials,sort_order) VALUES (1,'A','cal','Me','x',1)`).run()
  db.prepare(`INSERT INTO accounts (id,name,source,owner,credentials,sort_order) VALUES (2,'B','max','Me','x',2)`).run()
  db.prepare(`INSERT INTO accounts (id,name,source,owner,credentials,sort_order) VALUES (3,'C','isracard','Me','x',3)`).run()
  return db
}
const order = db => db.prepare(`SELECT id FROM accounts ORDER BY sort_order, id`).all().map(r => r.id)

test('moveAccount down swaps with the next account', () => {
  const db = seedThree()
  assert.strictEqual(moveAccount(db, 1, 'down'), true)
  assert.deepStrictEqual(order(db), [2, 1, 3])
})

test('moveAccount up swaps with the previous account', () => {
  const db = seedThree()
  assert.strictEqual(moveAccount(db, 3, 'up'), true)
  assert.deepStrictEqual(order(db), [1, 3, 2])
})

test('moving the top account up is a no-op (already at edge)', () => {
  const db = seedThree()
  assert.strictEqual(moveAccount(db, 1, 'up'), false)
  assert.deepStrictEqual(order(db), [1, 2, 3])
})

test('moving the bottom account down is a no-op (already at edge)', () => {
  const db = seedThree()
  assert.strictEqual(moveAccount(db, 3, 'down'), false)
  assert.deepStrictEqual(order(db), [1, 2, 3])
})

test('two moves down push an account from top to bottom', () => {
  const db = seedThree()
  moveAccount(db, 1, 'down')
  moveAccount(db, 1, 'down')
  assert.deepStrictEqual(order(db), [2, 3, 1])
})

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
