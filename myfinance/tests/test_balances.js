/**
 * Tests for account balances ("balance on update day").
 * In-memory DB. Run with:  node tests/test_balances.js
 */

import { DatabaseSync } from 'node:sqlite'
import assert from 'node:assert'
import { SCHEMA_SQL } from '../server/db/schema.js'
import { upsertBalance, balancesByAccount, netBalance } from '../server/db/balances.js'

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS  ${name}`) }
  catch (e) { failed++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

function freshDb() {
  const db = new DatabaseSync(':memory:')
  db.exec(SCHEMA_SQL)
  db.prepare(`INSERT INTO accounts (id,name,source,owner,credentials,include_in_totals) VALUES (1,'Bank','discount','Me','x',1)`).run()
  db.prepare(`INSERT INTO accounts (id,name,source,owner,credentials,include_in_totals) VALUES (2,'Cal','cal','Me','x',1)`).run()
  return db
}

console.log('\nBalance tests:')

test('upsert stores a balance and replaces it on conflict', () => {
  const db = freshDb()
  upsertBalance(db, 1, '123', 1000, '2026-06-01T00:00:00Z')
  upsertBalance(db, 1, '123', 1500, '2026-06-10T00:00:00Z')  // same account/number → update
  const row = db.prepare(`SELECT balance, balance_date FROM account_balances WHERE account_id=1 AND account_number='123'`).get()
  assert.strictEqual(row.balance, 1500)
  assert.strictEqual(row.balance_date, '2026-06-10T00:00:00Z')
  const count = db.prepare(`SELECT COUNT(*) c FROM account_balances`).get().c
  assert.strictEqual(count, 1)
})

test('balancesByAccount sums account numbers and ignores nulls', () => {
  const db = freshDb()
  upsertBalance(db, 1, 'A', 1000, '2026-06-10T00:00:00Z')
  upsertBalance(db, 1, 'B', 500,  '2026-06-11T00:00:00Z')
  upsertBalance(db, 2, 'C', null, '2026-06-10T00:00:00Z')  // a card → no balance
  const map = balancesByAccount(db)
  assert.strictEqual(map.get(1).balance, 1500)
  assert.strictEqual(map.get(1).balance_date, '2026-06-11T00:00:00Z')  // latest date
  assert.strictEqual(map.get(2).balance, null)  // only-null account reports null, not 0
})

test('netBalance over selected accounts', () => {
  const db = freshDb()
  upsertBalance(db, 1, 'A', 1000, 'd')
  upsertBalance(db, 2, 'C', 200,  'd')
  assert.strictEqual(netBalance(db, [1]), 1000)       // only account 1
  assert.strictEqual(netBalance(db, [1, 2]), 1200)    // both
  assert.strictEqual(netBalance(db), 1200)            // all (no ids)
})

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
