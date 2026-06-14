/**
 * Tests for internal-transfer detection and exclusion. In-memory DB.
 * Run: node tests/test_transfers.js
 */
import { DatabaseSync } from 'node:sqlite'
import assert from 'node:assert'
import { SCHEMA_SQL } from '../server/db/schema.js'
import { insertManualTransaction } from '../server/db/save-transactions.js'
import { seedCategories } from '../server/db/categories.js'
import { computeBudgetOverview } from '../server/db/budgets.js'
import {
  findTransferCandidates, markTransferPair, ignoreTransferPair, unmarkTransfer,
} from '../server/db/transfers.js'

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS  ${name}`) }
  catch (e) { failed++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

function freshDb() {
  const db = new DatabaseSync(':memory:')
  db.exec(SCHEMA_SQL)
  db.prepare(`INSERT INTO accounts (id,name,source,owner,credentials,include_in_totals) VALUES (1,'Bank A','discount','Boris','x',1)`).run()
  db.prepare(`INSERT INTO accounts (id,name,source,owner,credentials,include_in_totals) VALUES (2,'Bank B','hapoalim','Boris','x',1)`).run()
  seedCategories(db)
  return db
}
const add = (db, account_id, amount, date, category = 'מזון') =>
  insertManualTransaction(db, { date, description: 'x', amount, category, owner: 'Boris', account_id, account_name: `Bank ${account_id}` })
const find = (rows, cat) => rows.find(r => r.category === cat)

console.log('\nInternal-transfer tests:')

test('detects an opposite-sign, equal-amount pair on different accounts', () => {
  const db = freshDb()
  add(db, 1, -500, '2026-06-10')
  add(db, 2,  500, '2026-06-11')
  const pairs = findTransferCandidates(db)
  assert.strictEqual(pairs.length, 1)
  assert.strictEqual(pairs[0].amount, -500)  // a is the outgoing leg
})

test('same account or same sign produces no candidate', () => {
  let db = freshDb()
  add(db, 1, -500, '2026-06-10'); add(db, 1, 500, '2026-06-11')  // same account
  assert.strictEqual(findTransferCandidates(db).length, 0)
  db = freshDb()
  add(db, 1, -500, '2026-06-10'); add(db, 2, -500, '2026-06-11') // same sign
  assert.strictEqual(findTransferCandidates(db).length, 0)
})

test('pairs outside the date window are not suggested', () => {
  const db = freshDb()
  add(db, 1, -500, '2026-06-01')
  add(db, 2,  500, '2026-06-20')   // 19 days apart, default window 5
  assert.strictEqual(findTransferCandidates(db).length, 0)
})

test('marking a pair flags both legs and drops them from budget spent', () => {
  const db = freshDb()
  add(db, 1, -500, '2026-06-10')   // expense leg in מזון
  add(db, 2,  500, '2026-06-11')
  assert.strictEqual(find(computeBudgetOverview(db, '2026-06'), 'מזון').spent, 500)
  const [p] = findTransferCandidates(db)
  markTransferPair(db, p.a_id, p.b_id)
  assert.strictEqual(find(computeBudgetOverview(db, '2026-06'), 'מזון').spent, 0)
  assert.strictEqual(findTransferCandidates(db).length, 0)  // no longer suggested
})

test('unmark restores a transaction to the totals', () => {
  const db = freshDb()
  const a = add(db, 1, -500, '2026-06-10')
  add(db, 2, 500, '2026-06-11')
  const [p] = findTransferCandidates(db)
  markTransferPair(db, p.a_id, p.b_id)
  unmarkTransfer(db, a)
  assert.strictEqual(find(computeBudgetOverview(db, '2026-06'), 'מזון').spent, 500)
})

test('an ignored pair is never suggested again', () => {
  const db = freshDb()
  add(db, 1, -500, '2026-06-10')
  add(db, 2,  500, '2026-06-11')
  const [p] = findTransferCandidates(db)
  ignoreTransferPair(db, p.a_id, p.b_id)
  assert.strictEqual(findTransferCandidates(db).length, 0)
})

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
