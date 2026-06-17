/**
 * Tests for per-account-number inclusion. One login can expose several account
 * numbers; the user can exclude specific ones from totals. In-memory DB.
 *
 * Run with:  node tests/test_subaccounts.js
 */

import { DatabaseSync } from 'node:sqlite'
import assert from 'node:assert'
import { SCHEMA_SQL } from '../server/db/schema.js'
import { saveAccountTransactions } from '../server/db/save-transactions.js'
import { seedCategories } from '../server/db/categories.js'
import { computeBudgetOverview } from '../server/db/budgets.js'
import { listSubAccounts, listAllSubAccounts, setSubAccountIncluded, setSubAccountLabel } from '../server/db/subaccounts.js'

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS  ${name}`) }
  catch (e) { failed++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

const account = { id: 1, name: 'Bank Discount', source: 'discount', owner: 'Me' }

function txn(over = {}) {
  return {
    type: 'normal', date: '2026-06-10T00:00:00.000Z', processedDate: '2026-06-10T00:00:00.000Z',
    originalAmount: -100, originalCurrency: 'ILS', chargedAmount: -100, chargedCurrency: 'ILS',
    description: 'x', status: 'completed', category: 'מזון', ...over,
  }
}

function freshDb() {
  const db = new DatabaseSync(':memory:')
  db.exec(SCHEMA_SQL)
  db.prepare(`INSERT INTO accounts (id,name,source,owner,credentials,include_in_totals) VALUES (1,'Bank Discount','discount','Me','x',1)`).run()
  seedCategories(db)
  // Two account numbers under the same login.
  saveAccountTransactions(account, { accountNumber: '111', txns: [txn({ chargedAmount: -200, description: 'a' })] }, db)
  saveAccountTransactions(account, { accountNumber: '222', txns: [txn({ chargedAmount: -500, description: 'b' })] }, db)
  return db
}

const find = (rows, cat) => rows.find(r => r.category === cat)

console.log('\nSub-account inclusion tests:')

test('listSubAccounts reports each number, included by default', () => {
  const db = freshDb()
  const subs = listSubAccounts(db, 1)
  assert.strictEqual(subs.length, 2)
  assert.ok(subs.every(s => s.included))
  assert.deepStrictEqual(subs.map(s => s.account_number).sort(), ['111', '222'])
})

test('excluding a number drops it from budget "spent"', () => {
  const db = freshDb()
  assert.strictEqual(find(computeBudgetOverview(db, '2026-06'), 'מזון').spent, 700)  // 200 + 500
  setSubAccountIncluded(db, 1, '222', false)  // exclude the 500 one
  assert.strictEqual(find(computeBudgetOverview(db, '2026-06'), 'מזון').spent, 200)
  // listSubAccounts reflects the exclusion
  const s222 = listSubAccounts(db, 1).find(s => s.account_number === '222')
  assert.strictEqual(s222.included, false)
})

test('re-including a number restores it', () => {
  const db = freshDb()
  setSubAccountIncluded(db, 1, '222', false)
  setSubAccountIncluded(db, 1, '222', true)
  assert.strictEqual(find(computeBudgetOverview(db, '2026-06'), 'מזון').spent, 700)
  assert.ok(listSubAccounts(db, 1).every(s => s.included))
})

test('setSubAccountIncluded(false) is idempotent (no duplicate rows)', () => {
  const db = freshDb()
  setSubAccountIncluded(db, 1, '222', false)
  setSubAccountIncluded(db, 1, '222', false)
  const c = db.prepare(`SELECT COUNT(*) c FROM excluded_subaccounts WHERE account_id=1 AND account_number='222'`).get().c
  assert.strictEqual(c, 1)
})

test('label defaults to empty, then can be set and listed', () => {
  const db = freshDb()
  assert.ok(listSubAccounts(db, 1).every(s => s.label === ''))
  setSubAccountLabel(db, 1, '222', 'יומיומי')
  const s222 = listSubAccounts(db, 1).find(s => s.account_number === '222')
  assert.strictEqual(s222.label, 'יומיומי')
})

test('setting a label is an upsert (one row, value replaced)', () => {
  const db = freshDb()
  setSubAccountLabel(db, 1, '222', 'ראשון')
  setSubAccountLabel(db, 1, '222', 'שני')
  const c = db.prepare(`SELECT COUNT(*) c FROM subaccount_labels WHERE account_id=1 AND account_number='222'`).get().c
  assert.strictEqual(c, 1)
  assert.strictEqual(listSubAccounts(db, 1).find(s => s.account_number === '222').label, 'שני')
})

test('blank label clears the nickname (row removed)', () => {
  const db = freshDb()
  setSubAccountLabel(db, 1, '222', 'משהו')
  setSubAccountLabel(db, 1, '222', '   ')
  const c = db.prepare(`SELECT COUNT(*) c FROM subaccount_labels WHERE account_id=1 AND account_number='222'`).get().c
  assert.strictEqual(c, 0)
  assert.strictEqual(listSubAccounts(db, 1).find(s => s.account_number === '222').label, '')
})

test('label and inclusion are independent', () => {
  const db = freshDb()
  setSubAccountLabel(db, 1, '222', 'יומיומי')
  setSubAccountIncluded(db, 1, '222', false)
  const s222 = listSubAccounts(db, 1).find(s => s.account_number === '222')
  assert.strictEqual(s222.label, 'יומיומי')
  assert.strictEqual(s222.included, false)
})

test('listAllSubAccounts lists every number with parent name, count and label', () => {
  const db = freshDb()
  setSubAccountLabel(db, 1, '111', 'יומיומי')
  const all = listAllSubAccounts(db)
  assert.strictEqual(all.length, 2)
  const a111 = all.find(s => s.account_number === '111')
  assert.strictEqual(a111.account_id, 1)
  assert.strictEqual(a111.account_name, 'Bank Discount')
  assert.strictEqual(a111.label, 'יומיומי')
  assert.strictEqual(a111.txn_count, 1)
  const a222 = all.find(s => s.account_number === '222')
  assert.strictEqual(a222.label, null)  // no label set → null from the subquery
})

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
