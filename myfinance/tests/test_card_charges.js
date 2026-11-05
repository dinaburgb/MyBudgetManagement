/**
 * Tests for the upcoming credit-card charge ("סכום לחיוב הקרוב").
 * A card reports no balance, so the number shown for it is the next debit:
 * the nearest charge date (processed_date) still ahead, and the net sum of the
 * transactions carrying that date. In-memory DB.
 *
 * Run with:  node tests/test_card_charges.js
 */

import { DatabaseSync } from 'node:sqlite'
import assert from 'node:assert'
import { SCHEMA_SQL } from '../server/db/schema.js'
import { saveAccountTransactions, insertManualTransaction } from '../server/db/save-transactions.js'
import { seedCategories } from '../server/db/categories.js'
import { listSubAccounts } from '../server/db/subaccounts.js'
import { upcomingChargeByAccount, upcomingChargeBySubAccount, upcomingChargeByCard,
         upcomingChargeTotal, todayYmd } from '../server/db/card-charges.js'

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS  ${name}`) }
  catch (e) { failed++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

const TODAY = '2026-11-05'

const bank = { id: 1, name: 'Bank Discount', source: 'discount', owner: 'Me' }
const cal  = { id: 2, name: 'Visa Cal',      source: 'cal',      owner: 'Me' }
const max  = { id: 3, name: 'Max',           source: 'max',      owner: 'Me' }

/** One scraped transaction. `charge` is the processed (charge) date. */
function txn(amount, charge, over = {}) {
  return {
    type: 'normal',
    date: '2026-10-20T00:00:00.000Z',
    processedDate: `${charge}T00:00:00.000Z`,
    originalAmount: amount, originalCurrency: 'ILS',
    chargedAmount: amount, chargedCurrency: 'ILS',
    description: 'x', status: 'completed', category: 'מזון', ...over,
  }
}

function freshDb() {
  const db = new DatabaseSync(':memory:')
  db.exec(SCHEMA_SQL)
  db.prepare(`INSERT INTO accounts (id,name,source,owner,credentials) VALUES (1,'Bank Discount','discount','Me','x')`).run()
  db.prepare(`INSERT INTO accounts (id,name,source,owner,credentials) VALUES (2,'Visa Cal','cal','Me','x')`).run()
  db.prepare(`INSERT INTO accounts (id,name,source,owner,credentials) VALUES (3,'Max','max','Me','x')`).run()
  seedCategories(db)
  return db
}

console.log('\nUpcoming card charge tests:')

test('the charge is the nearest future date only — later installments are not added in', () => {
  const db = freshDb()
  saveAccountTransactions(cal, { accountNumber: '7364', txns: [
    txn(-1000, '2026-11-14'),
    txn(-500,  '2026-11-14'),
    txn(-83,   '2026-12-14'),   // next month's installment — not part of this charge
  ] }, db)
  const u = upcomingChargeByAccount(db, TODAY).get(2)
  assert.strictEqual(u.from, '2026-11-14')
  assert.strictEqual(u.to,   '2026-11-14')   // one card → one date, not a range
  assert.strictEqual(u.amount, 1500)   // positive = money leaving the account
  assert.strictEqual(u.txns, 2)
})

test('refunds on the charge date reduce it; a net refund reports a credit', () => {
  const db = freshDb()
  saveAccountTransactions(cal, { accountNumber: '7364', txns: [
    txn(-1000, '2026-11-14', { description: 'buy' }),
    txn(300,   '2026-11-14', { description: 'refund' }),
  ] }, db)
  assert.strictEqual(upcomingChargeByAccount(db, TODAY).get(2).amount, 700)

  const db2 = freshDb()
  saveAccountTransactions(cal, { accountNumber: '7364', txns: [
    txn(-200,  '2026-11-14', { description: 'buy' }),
    txn(1200,  '2026-11-14', { description: 'big refund' }),
  ] }, db2)
  assert.strictEqual(upcomingChargeByAccount(db2, TODAY).get(2).amount, -1000)  // negative = in the user's favour
})

test('a charge dated today still counts', () => {
  const db = freshDb()
  saveAccountTransactions(cal, { accountNumber: '7364', txns: [txn(-250, TODAY)] }, db)
  const u = upcomingChargeByAccount(db, TODAY).get(2)
  assert.strictEqual(u.from, TODAY)
  assert.strictEqual(u.amount, 250)
})

test('a card whose charges are all in the past reports nothing', () => {
  const db = freshDb()
  saveAccountTransactions(cal, { accountNumber: '7364', txns: [
    txn(-1000, '2026-10-14'),
    txn(-700,  '2026-09-14'),
  ] }, db)
  assert.strictEqual(upcomingChargeByAccount(db, TODAY).has(2), false)
})

test('bank accounts never report an upcoming charge, even with future-dated rows', () => {
  const db = freshDb()
  saveAccountTransactions(bank, { accountNumber: '111', txns: [txn(-900, '2026-11-20')] }, db)
  assert.strictEqual(upcomingChargeByAccount(db, TODAY).has(1), false)
})

test('manual entries on a card do not invent a charge (their date is not a charge date)', () => {
  const db = freshDb()
  insertManualTransaction(db, {
    date: '2026-11-20', description: 'cash', amount: -50, category: 'מזון', account_id: 2,
  })
  assert.strictEqual(upcomingChargeByAccount(db, TODAY).has(2), false)
})

test('pending transactions count toward the charge', () => {
  const db = freshDb()
  saveAccountTransactions(cal, { accountNumber: '7364', txns: [
    txn(-100, '2026-11-14'),
    txn(-60,  '2026-11-14', { status: 'pending', identifier: 'p1' }),
  ] }, db)
  assert.strictEqual(upcomingChargeByAccount(db, TODAY).get(2).amount, 160)
})

test('one login, two cards: the login adds them up, each card keeps its own', () => {
  const db = freshDb()
  saveAccountTransactions(max, { accountNumber: '8927', txns: [txn(-7000, '2026-11-09')] }, db)
  saveAccountTransactions(max, { accountNumber: '0795', txns: [txn(-200,  '2026-11-09')] }, db)
  saveAccountTransactions(max, { accountNumber: '0795', txns: [txn(-83,   '2026-12-09')] }, db)

  // Login level: the debit on 09/11 covers both cards.
  const login = upcomingChargeByAccount(db, TODAY).get(3)
  assert.strictEqual(login.from, '2026-11-09')
  assert.strictEqual(login.amount, 7200)
  assert.strictEqual(login.txns, 2)

  // Card level: each number reports its own nearest date.
  const perCard = upcomingChargeBySubAccount(db, 3, TODAY)
  assert.strictEqual(perCard.get('8927').amount, 7000)
  assert.strictEqual(perCard.get('0795').amount, 200)
  assert.strictEqual(perCard.get('0795').date, '2026-11-09')
})

test('cards on different cycles: the login sums both and reports the date range', () => {
  const db = freshDb()
  saveAccountTransactions(max, { accountNumber: '8927', txns: [txn(-500, '2026-11-09')] }, db)
  saveAccountTransactions(max, { accountNumber: '0795', txns: [txn(-300, '2026-11-25')] }, db)
  const perCard = upcomingChargeBySubAccount(db, 3, TODAY)
  assert.strictEqual(perCard.get('8927').date, '2026-11-09')
  assert.strictEqual(perCard.get('0795').date, '2026-11-25')
  // The login figure is the sum of its cards, so the page adds up; the two
  // different dates become a range the UI can show.
  const login = upcomingChargeByAccount(db, TODAY).get(3)
  assert.strictEqual(login.amount, 800)
  assert.strictEqual(login.from, '2026-11-09')
  assert.strictEqual(login.to,   '2026-11-25')
  assert.strictEqual(login.cards, 2)
})

test('the page adds up: the total equals the sum of the login figures', () => {
  const db = freshDb()
  saveAccountTransactions(max, { accountNumber: '8927', txns: [txn(-500, '2026-11-09')] }, db)
  saveAccountTransactions(max, { accountNumber: '0795', txns: [txn(-300, '2026-11-25')] }, db)
  saveAccountTransactions(cal, { accountNumber: '7364', txns: [txn(-900, '2026-11-14')] }, db)
  const logins = [...upcomingChargeByAccount(db, TODAY).values()]
  const sum = logins.reduce((t, l) => t + l.amount, 0)
  assert.strictEqual(sum, upcomingChargeTotal(db, TODAY).amount)
  assert.strictEqual(sum, 1700)
})

test('an unticked card is left out of its login figure, but still shows on its own row', () => {
  const db = freshDb()
  saveAccountTransactions(max, { accountNumber: '8927', txns: [txn(-500, '2026-11-09')] }, db)
  saveAccountTransactions(max, { accountNumber: '0795', txns: [txn(-300, '2026-11-09')] }, db)
  db.prepare(`INSERT INTO excluded_subaccounts (account_id, account_number) VALUES (3, '0795')`).run()
  assert.strictEqual(upcomingChargeByAccount(db, TODAY).get(3).amount, 500)
  // The card's own row keeps reporting its charge — that is how the user sees
  // what unticking it leaves out.
  assert.strictEqual(upcomingChargeBySubAccount(db, 3, TODAY).get('0795').amount, 300)
})

test('a login whose cards are all unticked reports no charge at all', () => {
  const db = freshDb()
  saveAccountTransactions(max, { accountNumber: '8927', txns: [txn(-500, '2026-11-09')] }, db)
  db.prepare(`INSERT INTO excluded_subaccounts (account_id, account_number) VALUES (3, '8927')`).run()
  assert.strictEqual(upcomingChargeByAccount(db, TODAY).has(3), false)
})

test('unticking the card with the nearest date moves the login to the next one', () => {
  const db = freshDb()
  saveAccountTransactions(max, { accountNumber: '8927', txns: [txn(-500, '2026-11-09')] }, db)
  saveAccountTransactions(max, { accountNumber: '0795', txns: [txn(-300, '2026-11-25')] }, db)
  db.prepare(`INSERT INTO excluded_subaccounts (account_id, account_number) VALUES (3, '8927')`).run()
  const login = upcomingChargeByAccount(db, TODAY).get(3)
  assert.strictEqual(login.from, '2026-11-25')   // not the excluded card's 09/11
  assert.strictEqual(login.amount, 300)
})

test('listSubAccounts carries the charge for cards and nulls for bank numbers', () => {
  const db = freshDb()
  // A future-dated card charge is visible per card number...
  saveAccountTransactions(cal, { accountNumber: '7364', txns: [txn(-1234, '2999-01-09')] }, db)
  const card = listSubAccounts(db, 2).find(s => s.account_number === '7364')
  assert.strictEqual(card.upcoming_charge, 1234)
  assert.strictEqual(card.upcoming_charge_date, '2999-01-09')
  assert.strictEqual(card.upcoming_charge_txns, 1)

  // ...while a bank number reports null, like its card-less balance.
  saveAccountTransactions(bank, { accountNumber: '111', txns: [txn(-900, '2999-01-09')] }, db)
  const acct = listSubAccounts(db, 1).find(s => s.account_number === '111')
  assert.strictEqual(acct.upcoming_charge, null)
  assert.strictEqual(acct.upcoming_charge_date, null)
})

test('todayYmd returns a local YYYY-MM-DD', () => {
  assert.strictEqual(todayYmd(new Date(2026, 10, 5)), '2026-11-05')
  assert.strictEqual(todayYmd(new Date(2026, 0, 9)),  '2026-01-09')
  assert.match(todayYmd(), /^\d{4}-\d{2}-\d{2}$/)
})

test('the total adds up every included card across all logins', () => {
  const db = freshDb()
  saveAccountTransactions(cal, { accountNumber: '7364', txns: [txn(-2589, '2026-11-14')] }, db)
  saveAccountTransactions(max, { accountNumber: '8927', txns: [txn(-7780, '2026-11-09')] }, db)
  saveAccountTransactions(max, { accountNumber: '0795', txns: [txn(-225,  '2026-11-09')] }, db)
  const t = upcomingChargeTotal(db, TODAY)
  assert.strictEqual(t.amount, 10594)
  assert.strictEqual(t.cards, 3)
  assert.strictEqual(t.txns, 3)
  assert.strictEqual(t.from, '2026-11-09')   // earliest charge date counted
  assert.strictEqual(t.to,   '2026-11-14')   // latest
  assert.strictEqual(t.skipped.cards, 0)
})

test('a login left out of totals is not added in, and is reported as skipped', () => {
  const db = freshDb()
  saveAccountTransactions(cal, { accountNumber: '7364', txns: [txn(-2589, '2026-11-14')] }, db)
  saveAccountTransactions(max, { accountNumber: '8927', txns: [txn(-7780, '2026-11-09')] }, db)
  db.prepare(`UPDATE accounts SET include_in_totals = 0 WHERE id = 3`).run()   // the Max login
  const t = upcomingChargeTotal(db, TODAY)
  assert.strictEqual(t.amount, 2589)
  assert.strictEqual(t.cards, 1)
  assert.strictEqual(t.from, '2026-11-14')
  assert.strictEqual(t.skipped.cards, 1)
  assert.strictEqual(t.skipped.amount, 7780)
})

test('an individually unticked card is not added in, and is reported as skipped', () => {
  const db = freshDb()
  saveAccountTransactions(max, { accountNumber: '8927', txns: [txn(-7780, '2026-11-09')] }, db)
  saveAccountTransactions(max, { accountNumber: '0795', txns: [txn(-225,  '2026-11-09')] }, db)
  db.prepare(`INSERT INTO excluded_subaccounts (account_id, account_number) VALUES (3, '0795')`).run()
  const t = upcomingChargeTotal(db, TODAY)
  assert.strictEqual(t.amount, 7780)
  assert.strictEqual(t.cards, 1)
  assert.strictEqual(t.skipped.cards, 1)
  assert.strictEqual(t.skipped.amount, 225)
  // The login line shows the same included-only figure, so the strip's total
  // is exactly the sum of what is written next to the logins.
  assert.strictEqual(upcomingChargeByAccount(db, TODAY).get(3).amount, 7780)
})

test('each card contributes its own next date, not the earliest one overall', () => {
  const db = freshDb()
  saveAccountTransactions(max, { accountNumber: '8927', txns: [txn(-500, '2026-11-09')] }, db)
  saveAccountTransactions(cal, { accountNumber: '7364', txns: [
    txn(-300, '2026-11-25'),
    txn(-900, '2026-12-25'),   // the charge after that — not part of this total
  ] }, db)
  const t = upcomingChargeTotal(db, TODAY)
  assert.strictEqual(t.amount, 800)
  assert.strictEqual(t.to, '2026-11-25')
})

test('nothing coming up: a zero total with no dates', () => {
  const db = freshDb()
  saveAccountTransactions(cal, { accountNumber: '7364', txns: [txn(-1000, '2026-10-14')] }, db)
  const t = upcomingChargeTotal(db, TODAY)
  assert.strictEqual(t.amount, 0)
  assert.strictEqual(t.cards, 0)
  assert.strictEqual(t.from, null)
  assert.strictEqual(t.to, null)
})

test('a net refund makes the total negative (money coming back)', () => {
  const db = freshDb()
  saveAccountTransactions(cal, { accountNumber: '7364', txns: [
    txn(-200, '2026-11-14'),
    txn(900,  '2026-11-14', { description: 'refund' }),
  ] }, db)
  assert.strictEqual(upcomingChargeTotal(db, TODAY).amount, -700)
})

test('bank accounts and manual entries never reach the total', () => {
  const db = freshDb()
  saveAccountTransactions(bank, { accountNumber: '111', txns: [txn(-900, '2026-11-20')] }, db)
  insertManualTransaction(db, { date: '2026-11-20', description: 'cash', amount: -50, category: 'מזון', account_id: 2 })
  const t = upcomingChargeTotal(db, TODAY)
  assert.strictEqual(t.amount, 0)
  assert.strictEqual(t.cards, 0)
})

test('upcomingChargeByCard lists one row per card with its inclusion flag', () => {
  const db = freshDb()
  saveAccountTransactions(max, { accountNumber: '8927', txns: [txn(-500, '2026-11-09')] }, db)
  saveAccountTransactions(max, { accountNumber: '0795', txns: [txn(-300, '2026-11-09')] }, db)
  db.prepare(`INSERT INTO excluded_subaccounts (account_id, account_number) VALUES (3, '0795')`).run()
  const rows = upcomingChargeByCard(db, TODAY)
  assert.strictEqual(rows.length, 2)
  assert.strictEqual(rows.find(r => r.account_number === '8927').included, true)
  assert.strictEqual(rows.find(r => r.account_number === '0795').included, false)
})

console.log(`\n  ${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
