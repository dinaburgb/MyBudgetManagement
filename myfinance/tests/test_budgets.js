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
import { computeBudgetOverview, computeIncomeOverview, monthlyBudgetSummary, setBudget, deleteBudget, isValidMonth, budgetSummaryForMonths, budgetSuggestions, budgetEnvelope } from '../server/db/budgets.js'
import { seedCategories } from '../server/db/categories.js'

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
  seedCategories(db)
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
  saveAccountTransactions(account,  { accountNumber: '1', txns: [txn({ category: 'רכב', chargedAmount: -100, description: 'a' })] }, db)
  saveAccountTransactions(excluded, { accountNumber: '2', txns: [txn({ category: 'רכב', chargedAmount: -500, description: 'b' })] }, db)
  const rows = computeBudgetOverview(db, '2026-06')
  assert.strictEqual(find(rows, 'רכב').spent, 100)  // excluded account's 500 not counted
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
  setBudget(db, 'רכב', 500)
  setBudget(db, 'רכב', 800)  // update same (category, '')
  const count = db.prepare(`SELECT COUNT(*) c FROM budgets WHERE category='רכב'`).get().c
  assert.strictEqual(count, 1)
  assert.strictEqual(find(computeBudgetOverview(db, '2026-06'), 'רכב').limit, 800)
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

test('budgetSummaryForMonths sums the effective limit across months', () => {
  const db = freshDb()
  setBudget(db, 'מזון', 3000)             // recurring default
  setBudget(db, 'מזון', 5000, '2026-06')  // June override
  setBudget(db, 'רכב', 800, '2026-07')    // only July, no default
  const t = budgetSummaryForMonths(db, ['2026-06', '2026-07'])
  assert.strictEqual(t.get('מזון'), 8000)  // 5000 (June override) + 3000 (July default)
  assert.strictEqual(t.get('רכב'), 800)    // only the July override counts
  assert.ok(!t.has('בידור'))               // never budgeted → absent (empty cell)
})

test('excluded categories are dropped from the budget overview', () => {
  const db = freshDb()
  db.prepare(`UPDATE categories SET is_excluded = 1 WHERE name = 'קניות'`).run()
  saveAccountTransactions(account, { accountNumber: '1', txns: [
    txn({ category: 'קניות', chargedAmount: -300, description: 'cc repay' }),
  ] }, db)
  const rows = computeBudgetOverview(db, '2026-06')
  assert.ok(!rows.find(r => r.category === 'קניות'), 'excluded category must not appear')
  assert.ok(rows.find(r => r.category === 'מזון'), 'normal categories still appear')
})

test('budgetSuggestions averages spend over the last 6 complete months', () => {
  const db = freshDb()
  // A charge dated in the previous (complete) month, computed the same way the
  // function does — so the test is independent of the real calendar date.
  const d = new Date()
  const prev = new Date(d.getFullYear(), d.getMonth() - 1, 15)
  const iso = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-15T00:00:00.000Z`
  saveAccountTransactions(account, { accountNumber: '1', txns: [
    txn({ category: 'מזון', chargedAmount: -600, description: 'x', date: iso, processedDate: iso }),
  ] }, db)
  const { suggestions } = budgetSuggestions(db, 6)
  assert.strictEqual(suggestions['מזון'], 100)  // 600 / 6 = 100, rounded to nearest 10
})

test('carryover accumulates under- and over-spend from effective_from', () => {
  const db = freshDb()
  // Budget 1000/month starting April 2026.
  setBudget(db, 'מזון', 1000, '', '2026-04')
  saveAccountTransactions(account, { accountNumber: '1', txns: [
    txn({ category: 'מזון', chargedAmount: -800,  date: '2026-04-10T00:00:00.000Z', description: 'apr' }),  // -200 from limit → +200
    txn({ category: 'מזון', chargedAmount: -1300, date: '2026-05-10T00:00:00.000Z', description: 'may' }),  // over by 300 → -300
    txn({ category: 'מזון', chargedAmount: -600,  date: '2026-06-10T00:00:00.000Z', description: 'jun' }),  // +400
  ] }, db)
  // Through May: (1000-800) + (1000-1300) = 200 - 300 = -100
  assert.strictEqual(budgetEnvelope(db, '2026-05').get('מזון'), -100)
  // Through June: -100 + (1000-600) = 300
  const june = find(computeBudgetOverview(db, '2026-06'), 'מזון')
  assert.strictEqual(june.carryover, 300)
  assert.strictEqual(june.remaining, 400)  // monthly remaining is independent
})

test('effective_from excludes months before the budget started', () => {
  const db = freshDb()
  setBudget(db, 'מזון', 1000, '', '2026-06')  // starts June
  saveAccountTransactions(account, { accountNumber: '1', txns: [
    txn({ category: 'מזון', chargedAmount: -5000, date: '2026-03-10T00:00:00.000Z', description: 'march' }), // before start, ignored
    txn({ category: 'מזון', chargedAmount: -700,  date: '2026-06-10T00:00:00.000Z', description: 'june' }),
  ] }, db)
  const june = find(computeBudgetOverview(db, '2026-06'), 'מזון')
  assert.strictEqual(june.carryover, 300)  // only June counts: 1000 - 700
  assert.strictEqual(june.effectiveFrom, '2026-06')
})

test('income categories are split out: earned vs target, kept out of expense rows', () => {
  const db = freshDb()
  db.prepare(`UPDATE categories SET is_income = 1 WHERE name = 'בריאות'`).run()  // treat as income for the test
  setBudget(db, 'בריאות', 18000)  // expected monthly income (target)
  saveAccountTransactions(account, { accountNumber: '1', txns: [
    txn({ category: 'בריאות', chargedAmount: 17000, description: 'salary' }),
    txn({ category: 'בריאות', chargedAmount: 200,   description: 'bonus' }),
    txn({ category: 'מזון',   chargedAmount: -300,  description: 'food' }),
  ] }, db)

  // Not among the expense tiles.
  const expense = computeBudgetOverview(db, '2026-06')
  assert.ok(!expense.find(r => r.category === 'בריאות'), 'income category must not appear in expense rows')

  const income = computeIncomeOverview(db, '2026-06')
  const row = income.find(r => r.category === 'בריאות')
  assert.strictEqual(row.kind, 'income')
  assert.strictEqual(row.limit, 18000)
  assert.strictEqual(row.earned, 17200)        // 17000 + 200, positives only
  assert.strictEqual(row.remaining, 800)       // 18000 - 17200 short of target
})

test('computeIncomeOverview is empty when no income categories exist', () => {
  const db = freshDb()
  assert.deepStrictEqual(computeIncomeOverview(db, '2026-06'), [])
})

test('monthlyBudgetSummary rolls up planned vs actual income/expense per data month', () => {
  const db = freshDb()
  db.prepare(`UPDATE categories SET is_income = 1 WHERE name = 'בריאות'`).run()  // income for the test
  setBudget(db, 'מזון', 1000)      // expense default
  setBudget(db, 'בריאות', 18000)   // income target
  saveAccountTransactions(account, { accountNumber: '1', txns: [
    txn({ category: 'מזון',   chargedAmount: -800,   date: '2026-05-10T00:00:00.000Z', description: 'm-may' }),
    txn({ category: 'בריאות', chargedAmount: 17000,  date: '2026-05-05T00:00:00.000Z', description: 'i-may' }),
    txn({ category: 'מזון',   chargedAmount: -1200,  date: '2026-06-10T00:00:00.000Z', description: 'm-jun' }),
    txn({ category: 'בריאות', chargedAmount: 18000,  date: '2026-06-05T00:00:00.000Z', description: 'i-jun' }),
  ] }, db)

  const months = monthlyBudgetSummary(db)
  assert.deepStrictEqual(months.map(m => m.month), ['2026-05', '2026-06'])  // oldest first
  const may = months[0]
  assert.strictEqual(may.plannedExpense, 1000)
  assert.strictEqual(may.actualExpense, 800)
  assert.strictEqual(may.plannedIncome, 18000)
  assert.strictEqual(may.actualIncome, 17000)
  assert.strictEqual(may.actualBalance, 16200)   // 17000 - 800
  assert.strictEqual(may.plannedBalance, 17000)  // 18000 - 1000
  assert.strictEqual(months[1].actualBalance, 16800)  // 18000 - 1200
})

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
