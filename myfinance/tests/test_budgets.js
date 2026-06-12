/**
 * Tests for budget limits (monthly, per category).
 * In-memory DB, fake transactions — no real data.
 *
 * Run with:  node tests/test_budgets.js
 */

import { DatabaseSync } from 'node:sqlite'
import assert from 'node:assert'
import { SCHEMA_SQL } from '../server/db/schema.js'
import { saveAccountTransactions } from '../server/db/save-transactions.js'
import { computeBudgetOverview, setBudget, deleteBudget, isValidMonth } from '../server/db/budgets.js'

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS  ${name}`) }
  catch (e) { failed++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

const account = { id: 1, name: 'Cal', source: 'cal', owner: 'Boris' }

function freshDb() {
  const db = new DatabaseSync(':memory:')
  db.exec(SCHEMA_SQL)
  db.prepare(`INSERT INTO accounts (id, name, source, owner, credentials, include_in_totals) VALUES (?,?,?,?,?,1)`)
    .run(account.id, account.name, account.source, account.owner, 'x')
  return db
}

function txn(over = {}) {
  return {
    type: 'normal', date: '2026-06-10T00:00:00.000Z', processedDate: '2026-06-10T00:00:00.000Z',
    originalAmount: -100, originalCurrency: 'ILS', chargedAmount: -100, chargedCurrency: 'ILS',
    description: 'x', status: 'completed', ...over,
  }
}

function find(rows, cat) { return rows.find(r => r.category === cat) }

console.log('\nBudget tests:')

test('isValidMonth accepts YYYY-MM and rejects junk', () => {
  assert.ok(isValidMonth('2026-06'))
  assert.ok(isValidMonth('2026-12'))
  assert.ok(!isValidMonth('2026-13'))
  assert.ok(!isValidMonth('2026-6'))
  assert.ok(!isValidMonth('june'))
})

test('spent is summed from expenses for the month, included accounts only', () => {
  const db = freshDb()
  saveAccountTransactions(account, { accountNumber: '1', txns: [
    txn({ category: 'מזון', chargedAmount: -200, description: 'a' }),
    txn({ category: 'מזון', chargedAmount: -50,  description: 'b' }),
    txn({ category: 'מזון', chargedAmount: 30,   description: 'refund' }),   // income, ignored
    txn({ category: 'מזון', chargedAmount: -999, date: '2026-05-10T00:00:00.000Z', description: 'prev month' }),
  ] }, db)
  const rows = computeBudgetOverview(db, '2026-06')
  assert.strictEqual(find(rows, 'מזון').spent, 250)  // 200 + 50, not the refund or May
})

test('excluded accounts are not counted in spent', () => {
  const db = freshDb()
  db.prepare(`INSERT INTO accounts (id,name,source,owner,credentials,include_in_totals) VALUES (2,'X','cal','Mom','x',0)`).run()
  const excluded = { id: 2, name: 'X', source: 'cal', owner: 'Mom' }
  saveAccountTransactions(account,  { accountNumber: '1', txns: [txn({ category: 'דלק', chargedAmount: -100, description: 'a' })] }, db)
  saveAccountTransactions(excluded, { accountNumber: '2', txns: [txn({ category: 'דלק', chargedAmount: -500, description: 'b' })] }, db)
  const rows = computeBudgetOverview(db, '2026-06')
  assert.strictEqual(find(rows, 'דלק').spent, 100)  // excluded account's 500 not counted
})

test('default limit applies to every month; overview reports remaining', () => {
  const db = freshDb()
  setBudget(db, 'מזון', 3000)  // recurring default
  saveAccountTransactions(account, { accountNumber: '1', txns: [txn({ category: 'מזון', chargedAmount: -1200, description: 'a' })] }, db)
  const rows = computeBudgetOverview(db, '2026-06')
  const food = find(rows, 'מזון')
  assert.strictEqual(food.limit, 3000)
  assert.strictEqual(food.source, 'default')
  assert.strictEqual(food.spent, 1200)
  assert.strictEqual(food.remaining, 1800)
})

test('a month override beats the default for that month only', () => {
  const db = freshDb()
  setBudget(db, 'מזון', 3000)             // default
  setBudget(db, 'מזון', 5000, '2026-06')  // June override
  const june = find(computeBudgetOverview(db, '2026-06'), 'מזון')
  const july = find(computeBudgetOverview(db, '2026-07'), 'מזון')
  assert.strictEqual(june.limit, 5000)
  assert.strictEqual(june.source, 'month')
  assert.strictEqual(july.limit, 3000)
  assert.strictEqual(july.source, 'default')
})

test('setBudget upserts (no duplicate rows)', () => {
  const db = freshDb()
  setBudget(db, 'דלק', 500)
  setBudget(db, 'דלק', 800)  // update same (category, '')
  const count = db.prepare(`SELECT COUNT(*) c FROM budgets WHERE category='דלק'`).get().c
  assert.strictEqual(count, 1)
  assert.strictEqual(find(computeBudgetOverview(db, '2026-06'), 'דלק').limit, 800)
})

test('deleteBudget removes only the targeted scope', () => {
  const db = freshDb()
  setBudget(db, 'מזון', 3000)
  setBudget(db, 'מזון', 5000, '2026-06')
  deleteBudget(db, 'מזון', '2026-06')  // remove only the override
  const june = find(computeBudgetOverview(db, '2026-06'), 'מזון')
  assert.strictEqual(june.limit, 3000)       // falls back to default
  assert.strictEqual(june.source, 'default')
})

test('category with no budget reports null limit and remaining', () => {
  const db = freshDb()
  const rows = computeBudgetOverview(db, '2026-06')
  const food = find(rows, 'מזון')
  assert.strictEqual(food.limit, null)
  assert.strictEqual(food.remaining, null)
})

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
