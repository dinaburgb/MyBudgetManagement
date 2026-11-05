/**
 * Tests for the read-only tools behind the MCP server (server/mcp/tools.js).
 * They are plain functions over a DB handle, so no MCP client is needed here.
 * In-memory DB.
 *
 * Run with:  node tests/test_mcp_tools.js
 */

import { DatabaseSync } from 'node:sqlite'
import assert from 'node:assert'
import { SCHEMA_SQL } from '../server/db/schema.js'
import { saveAccountTransactions, insertManualTransaction } from '../server/db/save-transactions.js'
import { seedCategories, addCategory } from '../server/db/categories.js'
import { upsertBalance } from '../server/db/balances.js'
import { setBudget } from '../server/db/budgets.js'
import {
  listAccounts, upcomingCardCharges, monthlySummary, categoryBreakdown,
  searchTransactions, budgetStatus, insights, netWorthSnapshot,
} from '../server/mcp/tools.js'

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS  ${name}`) }
  catch (e) { failed++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

const NOW = new Date(2026, 10, 15)   // 15 Nov 2026 — the "current" month in tests
const INCOME = 'הכנסה'

const bank = { id: 1, name: 'Bank Discount', source: 'discount', owner: 'Me' }
const card = { id: 2, name: 'Visa Cal',      source: 'cal',      owner: 'Me' }
const other = { id: 3, name: 'Old Bank',     source: 'fibi',     owner: 'Partner' }

function txn(amount, date, over = {}) {
  return {
    type: 'normal', date: `${date}T00:00:00.000Z`, processedDate: `${date}T00:00:00.000Z`,
    originalAmount: amount, originalCurrency: 'ILS',
    chargedAmount: amount, chargedCurrency: 'ILS',
    description: 'x', status: 'completed', category: 'מזון', ...over,
  }
}

function freshDb() {
  const db = new DatabaseSync(':memory:')
  db.exec(SCHEMA_SQL)
  db.prepare(`INSERT INTO accounts (id,name,source,owner,credentials) VALUES (1,'Bank Discount','discount','Me','SECRET-BLOB')`).run()
  db.prepare(`INSERT INTO accounts (id,name,source,owner,credentials) VALUES (2,'Visa Cal','cal','Me','SECRET-BLOB')`).run()
  db.prepare(`INSERT INTO accounts (id,name,source,owner,credentials,include_in_totals) VALUES (3,'Old Bank','fibi','Partner','SECRET-BLOB',0)`).run()
  seedCategories(db)
  addCategory(db, INCOME, '#34d399', { is_income: 1 })
  addCategory(db, 'החזר אשראי', '#94a3b8', { is_excluded: 1 })
  return db
}

console.log('\nMCP tools tests:')

test('list_accounts describes banks and cards without ever exposing credentials', () => {
  const db = freshDb()
  upsertBalance(db, 1, '111', 10000, '2026-11-01T00:00:00Z')
  saveAccountTransactions(card, { accountNumber: '7364', txns: [txn(-500, '2026-11-20')] }, db)

  const out = listAccounts(db)
  const asText = JSON.stringify(out)
  assert.ok(!asText.includes('SECRET-BLOB'), 'credentials must never reach the output')
  assert.ok(!asText.includes('credentials'), 'no credentials field at all')

  const discount = out.accounts.find(a => a.name === 'Bank Discount')
  assert.strictEqual(discount.kind, 'bank')
  assert.strictEqual(discount.balance, 10000)
  assert.strictEqual(discount.upcoming_charge, null)

  const visa = out.accounts.find(a => a.name === 'Visa Cal')
  assert.strictEqual(visa.kind, 'card')
  assert.strictEqual(visa.upcoming_charge, 500)
  assert.strictEqual(visa.balance, null)
})

test('list_accounts flags a login kept out of the totals', () => {
  const db = freshDb()
  upsertBalance(db, 3, '999', 20000, '2026-11-01T00:00:00Z')
  const out = listAccounts(db)
  const old = out.accounts.find(a => a.name === 'Old Bank')
  assert.strictEqual(old.counts_toward_totals, false)
  assert.strictEqual(old.balance, 20000)           // still reported, as the app shows it greyed
  assert.strictEqual(out.total_bank_balance, 0)    // but not added into the total
})

test('monthly_summary splits income from expenses and marks the current month partial', () => {
  const db = freshDb()
  saveAccountTransactions(bank, { accountNumber: '111', txns: [
    txn(12000, '2026-10-01', { category: INCOME, description: 'salary' }),
    txn(-2000, '2026-10-05'),
    txn(-1000, '2026-10-20'),
    txn(-300,  '2026-11-03'),
  ] }, db)

  const out = monthlySummary(db, { months: 2, now: NOW })
  const [oct, nov] = out.months
  assert.strictEqual(oct.month, '2026-10')
  assert.strictEqual(oct.income, 12000)
  assert.strictEqual(oct.expenses, 3000)
  assert.strictEqual(oct.net, 9000)
  assert.strictEqual(oct.partial, false)
  assert.strictEqual(nov.month, '2026-11')
  assert.strictEqual(nov.expenses, 300)
  assert.strictEqual(nov.partial, true)
})

test('monthly_summary ignores transfers, excluded categories and excluded logins', () => {
  const db = freshDb()
  saveAccountTransactions(bank, { accountNumber: '111', txns: [
    txn(-1000, '2026-10-05'),
    txn(-7000, '2026-10-10', { category: 'החזר אשראי', description: 'card repayment' }),  // excluded category
  ] }, db)
  saveAccountTransactions(other, { accountNumber: '999', txns: [txn(-5000, '2026-10-12')] }, db)  // excluded login
  db.prepare(`UPDATE transactions SET is_transfer = 1 WHERE description = 'card repayment'`).run()

  const oct = monthlySummary(db, { months: 2, now: NOW }).months[0]
  assert.strictEqual(oct.expenses, 1000)   // only the one that counts
})

test('category_breakdown ranks categories and gives each a share of the total', () => {
  const db = freshDb()
  saveAccountTransactions(bank, { accountNumber: '111', txns: [
    txn(-600, '2026-10-05', { category: 'מזון' }),
    txn(-200, '2026-10-06', { category: 'מזון', description: 'y' }),
    txn(-200, '2026-10-07', { category: 'רכב' }),
    txn(5000, '2026-10-08', { category: INCOME, description: 'salary' }),   // income is not spending
  ] }, db)

  const out = categoryBreakdown(db, { from: '2026-10-01', to: '2026-10-31' })
  assert.strictEqual(out.total_spent, 1000)
  assert.strictEqual(out.categories[0].category, 'מזון')
  assert.strictEqual(out.categories[0].spent, 800)
  assert.strictEqual(out.categories[0].share, 80)
  assert.strictEqual(out.categories[1].category, 'רכב')
  assert.strictEqual(out.categories.length, 2)
})

test('category_breakdown honours the date range', () => {
  const db = freshDb()
  saveAccountTransactions(bank, { accountNumber: '111', txns: [
    txn(-100, '2026-09-30'),
    txn(-250, '2026-10-15', { description: 'y' }),
  ] }, db)
  assert.strictEqual(categoryBreakdown(db, { from: '2026-10-01' }).total_spent, 250)
  assert.strictEqual(categoryBreakdown(db, { to: '2026-09-30' }).total_spent, 100)
  assert.strictEqual(categoryBreakdown(db, {}).total_spent, 350)
})

test('search_transactions matches text, category and dates, and caps the rows', () => {
  const db = freshDb()
  saveAccountTransactions(bank, { accountNumber: '111', txns: [
    txn(-90,  '2026-10-02', { description: 'שופרסל דיל' }),
    txn(-40,  '2026-10-03', { description: 'רמי לוי' }),
    txn(-30,  '2026-10-04', { description: 'דלק', category: 'רכב' }),
  ] }, db)

  assert.strictEqual(searchTransactions(db, { text: 'שופרסל' }).count, 1)
  assert.strictEqual(searchTransactions(db, { category: 'רכב' }).count, 1)
  assert.strictEqual(searchTransactions(db, { from: '2026-10-03' }).count, 2)
  assert.strictEqual(searchTransactions(db, { limit: 2 }).count, 2)

  const row = searchTransactions(db, { text: 'שופרסל' }).transactions[0]
  assert.strictEqual(row.amount, -90)          // signed: negative = expense
  assert.strictEqual(row.account, 'Bank Discount')
})

test('search_transactions skips accounts kept out of the totals unless asked', () => {
  const db = freshDb()
  saveAccountTransactions(other, { accountNumber: '999', txns: [txn(-77, '2026-10-02', { description: 'hidden one' })] }, db)
  assert.strictEqual(searchTransactions(db, { text: 'hidden' }).count, 0)
  assert.strictEqual(searchTransactions(db, { text: 'hidden', all_accounts: true }).count, 1)
})

test('search_transactions labels installments and pending rows', () => {
  const db = freshDb()
  saveAccountTransactions(card, { accountNumber: '7364', txns: [
    txn(-100, '2026-10-02', { type: 'installments', installments: { number: 2, total: 6 }, description: 'sofa' }),
    txn(-55,  '2026-10-03', { status: 'pending', description: 'not yet settled' }),
  ] }, db)

  const sofa = searchTransactions(db, { text: 'sofa' }).transactions[0]
  assert.strictEqual(sofa.installment, '2/6')
  assert.strictEqual(sofa.card, '7364')
  assert.strictEqual(sofa.status, undefined)        // completed rows say nothing

  const pending = searchTransactions(db, { text: 'not yet' }).transactions[0]
  assert.strictEqual(pending.status, 'pending')
})

test('upcoming_card_charges reports the total and every card behind it', () => {
  const db = freshDb()
  saveAccountTransactions(card, { accountNumber: '7364', txns: [txn(-2589, '2026-11-20')] }, db)
  saveAccountTransactions(card, { accountNumber: '2992', txns: [txn(-100,  '2026-11-20')] }, db)
  db.prepare(`INSERT INTO excluded_subaccounts (account_id, account_number) VALUES (2, '2992')`).run()

  const out = upcomingCardCharges(db)
  assert.strictEqual(out.total, 2589)
  assert.strictEqual(out.cards_counted, 1)
  assert.strictEqual(out.excluded.cards, 1)
  assert.strictEqual(out.excluded.amount, 100)
  assert.strictEqual(out.cards.length, 2)                                   // both are listed
  assert.strictEqual(out.cards.find(c => c.card === '2992').counts_toward_totals, false)
  assert.strictEqual(out.cards.find(c => c.card === '7364').account, 'Visa Cal')
})

test('net_balance adds up the included logins only', () => {
  const db = freshDb()
  upsertBalance(db, 1, '111', 10000, '2026-11-01T00:00:00Z')
  upsertBalance(db, 3, '999', 20000, '2026-11-01T00:00:00Z')   // login kept out of the totals
  saveAccountTransactions(card, { accountNumber: '7364', txns: [txn(-500, '2026-11-20')] }, db)

  const out = netWorthSnapshot(db)
  assert.strictEqual(out.net_bank_balance, 10000)
  assert.strictEqual(out.upcoming_card_charges, 500)
})

test('budget_status compares a budget with what was actually spent', () => {
  const db = freshDb()
  setBudget(db, 'מזון', 3000)
  saveAccountTransactions(bank, { accountNumber: '111', txns: [txn(-1200, '2026-11-04')] }, db)
  const out = budgetStatus(db, { month: '2026-11' })
  assert.strictEqual(out.month, '2026-11')
  const food = out.rows.find(r => r.category === 'מזון')
  assert.strictEqual(food.budget, 3000)
  assert.strictEqual(food.spent, 1200)
})

test('budget_status defaults to the current month', () => {
  const db = freshDb()
  assert.strictEqual(budgetStatus(db, { now: NOW }).month, '2026-11')
})

test('insights answers over complete months and leaves the current one out', () => {
  const db = freshDb()
  for (const m of ['06', '07', '08', '09', '10']) {
    saveAccountTransactions(bank, { accountNumber: '111', txns: [
      txn(10000, `2026-${m}-01`, { category: INCOME, description: 'salary' }),
      txn(-4000, `2026-${m}-10`, { description: `food ${m}` }),
    ] }, db)
  }
  const out = insights(db, { monthsBack: 6 })
  assert.ok(out.window.count >= 3, 'should find the complete months')
  assert.ok(!out.window.months?.includes(out.window.currentMonth), 'the current month is excluded')
  assert.ok(out.representative_month)
  assert.ok(out.installments)
})

test('a manual cash entry shows up like any other transaction', () => {
  const db = freshDb()
  insertManualTransaction(db, { date: '2026-10-09', description: 'מזומן לשוק', amount: -120, category: 'מזון', account_id: 1 })
  const out = searchTransactions(db, { text: 'מזומן' })
  assert.strictEqual(out.count, 1)
  assert.strictEqual(out.transactions[0].amount, -120)
})

console.log(`\n  ${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
