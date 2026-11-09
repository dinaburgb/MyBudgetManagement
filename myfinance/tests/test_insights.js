/**
 * Tests for the Insights module (db/insights.js) — the monthly analysis behind
 * the "תובנות" page. In-memory DB, fake transactions — no real data.
 *
 * Run with:  node tests/test_insights.js
 */

import { DatabaseSync } from 'node:sqlite'
import assert from 'node:assert'
import { SCHEMA_SQL } from '../server/db/schema.js'
import { saveAccountTransactions } from '../server/db/save-transactions.js'
import { seedCategories } from '../server/db/categories.js'
import { setBudget, effectiveLimitsByMonth } from '../server/db/budgets.js'
import {
  median, quantile, addMonths, monthKey, completeMonths, normalizeMerchant,
  monthlyTotals, representativeMonth, incomeComposition, detectRecurring, spendingStructure,
  gapDrivers, budgetRealism, progress, periodicExpenses, installmentsInsight,
  computeInsights,
} from '../server/db/insights.js'

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS  ${name}`) }
  catch (e) { failed++; console.log(`  FAIL  ${name}\n        ${e.stack.split('\n').slice(0, 3).join('\n        ')}`) }
}

const account = { id: 1, name: 'Card', source: 'max', owner: 'Me' }
const NOW = new Date(2026, 8, 13)            // 13 Sep 2026 → current month 2026-09
const MONTHS = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08']
const INCOME = new Set(['הכנסות'])

function freshDb() {
  const db = new DatabaseSync(':memory:')
  db.exec(SCHEMA_SQL)
  db.prepare(`INSERT INTO accounts (id, name, source, owner, credentials, include_in_totals) VALUES (?,?,?,?,?,1)`)
    .run(account.id, account.name, account.source, account.owner, 'x')
  seedCategories(db)
  db.prepare(`INSERT INTO categories (name, is_income) VALUES ('הכנסות', 1)`).run()
  return db
}

/** One fake charge. amount < 0 = expense, > 0 = income. day defaults to the 10th. */
function txn(month, description, amount, category, over = {}) {
  const day = over.day || 10
  const date = `${month}-${String(day).padStart(2, '0')}T00:00:00.000Z`
  return {
    type: 'normal', date, processedDate: date,
    originalAmount: amount, originalCurrency: 'ILS', chargedAmount: amount, chargedCurrency: 'ILS',
    description, status: 'completed', category, ...over,
  }
}

/** An installment charge: number/total of a plan whose full price is `full`. */
function inst(month, description, perMonth, number, total, full, category = 'קניות') {
  return txn(month, description, -perMonth, category, {
    type: 'installments', installments: { number, total }, originalAmount: -full,
  })
}

function save(db, txns) { saveAccountTransactions(account, { accountNumber: '1', txns }, db) }

/** Load the window rows the way computeInsights does (via the public API). */
function windowRows(db, months) {
  const ph = months.map(() => '?').join(',')
  return db.prepare(`
    SELECT id, substr(date,1,7) AS month, date, amount, category, description, type,
           installment_number, installment_total, original_amount
    FROM transactions WHERE substr(date,1,7) IN (${ph}) AND is_transfer = 0
  `).all(...months)
}

/** A "normal family" fixture: salary, rent, phone, bi-monthly water, groceries. */
function normalFamily(db, { salary = 20000, rent = 6000, groceriesPerVisit = 300, visits = 12 } = {}) {
  const txns = []
  MONTHS.forEach((m, i) => {
    txns.push(txn(m, 'משכורת', salary, 'הכנסות', { day: 1 }))
    txns.push(txn(m, 'שכר דירה', -rent, 'חשבונות בית', { day: 2 }))
    txns.push(txn(m, 'פלאפון 050-1234567', -(100 + i), 'תקשורת ואפליקציות', { day: 5 }))   // slowly varying
    if (i % 2 === 0) txns.push(txn(m, 'מי אביבים 88', -400, 'חשבונות בית', { day: 6 }))  // bi-monthly
    for (let v = 0; v < visits; v++) txns.push(txn(m, `שופרסל דיל ${v}`, -groceriesPerVisit, 'מזון', { day: 3 + v }))
  })
  save(db, txns)
}

console.log('\nInsights tests:')

// ---------------------------------------------------------------------------
test('helpers: median, quantile, addMonths, normalizeMerchant', () => {
  assert.strictEqual(median([5, 1, 3]), 3)
  assert.strictEqual(median([1, 2, 3, 4]), 2.5)
  assert.strictEqual(median([]), 0)
  assert.strictEqual(quantile([1, 2, 3, 4, 5], 0.5), 3)
  assert.strictEqual(quantile([1, 2, 3, 4, 5], 0.75), 4)
  assert.strictEqual(addMonths('2026-01', -2), '2025-11')
  assert.strictEqual(addMonths('2026-11', 3), '2027-02')
  assert.strictEqual(addMonths('2026-12', 0), '2026-12')
  assert.strictEqual(monthKey(NOW), '2026-09')
  assert.strictEqual(normalizeMerchant('שופרסל דיל 123 ת"א'), normalizeMerchant('שופרסל דיל 456-ת"א'))
  assert.notStrictEqual(normalizeMerchant('פלאפון'), normalizeMerchant('סלקום'))
})

test('completeMonths excludes the current month and honours the count', () => {
  const db = freshDb()
  normalFamily(db)
  save(db, [txn('2026-09', 'current month', -50, 'מזון'), txn('2026-02', 'old', -50, 'מזון')])
  assert.deepStrictEqual(completeMonths(db, 6, NOW), MONTHS)                 // 09 excluded, 02 dropped by count
  assert.deepStrictEqual(completeMonths(db, 'all', NOW), ['2026-02', ...MONTHS])
  assert.deepStrictEqual(completeMonths(db, 2, NOW), ['2026-07', '2026-08'])
})

// ---------------------------------------------------------------------------
test('representative month uses medians so one outlier month does not move it', () => {
  const db = freshDb()
  normalFamily(db)                                                    // steady ~10,100/month expenses
  save(db, [txn('2026-07', 'חופשה ביוון', -15000, 'נסיעות')])        // one exceptional month
  const rows = windowRows(db, MONTHS)
  const totals = monthlyTotals(rows, MONTHS, INCOME)
  const rep = representativeMonth(totals)
  assert.ok(rep.enough)
  assert.strictEqual(rep.median.income, 20000)
  // Median expenses stay at a normal month even though July is +15,000.
  const normal = totals.find(t => t.month === '2026-06').expenses
  assert.ok(Math.abs(rep.median.expenses - normal) < 500, `median ${rep.median.expenses} vs normal ${normal}`)
  assert.ok(rep.mean.expenses > rep.median.expenses + 2000)          // the mean IS dragged up
  assert.strictEqual(rep.annualizedNet, rep.median.net * 12)
  assert.strictEqual(rep.worst.month, '2026-07')
  assert.strictEqual(rep.volatility.outliers.length, 1)
  assert.strictEqual(rep.volatility.outliers[0].month, '2026-07')
  assert.strictEqual(rep.volatility.pattern, 'one-off')
})

test('income composition: salary timing jitter, one-offs, sporadic and frequent payers', () => {
  const db = freshDb()
  const txns = []
  // Salary paid 7 times in 6 months but only in 4 distinct months (31st vs 1st)
  ;[['2026-03', 1], ['2026-03', 31], ['2026-05', 1], ['2026-05', 31], ['2026-06', 30], ['2026-08', 1], ['2026-08', 31]]
    .forEach(([m, d]) => txns.push(txn(m, 'משכורת פועלים', 12000, 'הכנסות', { day: d })))
  txns.push(txn('2026-05', 'זיכוי זהב מעצמי', 40000, 'הכנסות'))                        // one-off transfer filed as income
  ;['2026-04', '2026-07'].forEach(m => txns.push(txn(m, 'חשבונית לקוח', 3000, 'הכנסות')))   // sporadic self-employment
  MONTHS.forEach(m => [5, 15, 25].forEach(d => txns.push(txn(m, 'cashback', 50, 'הכנסות', { day: d }))))  // frequent
  // Own company paying with a different memo every time — one payer, clustered by prefix
  ;[['2026-03', 'העברה מב.ד.ס.י. השקעות - משכורת'], ['2026-04', 'העברה מב.ד.ס.י. השקעות - מקדמה משכורת'],
    ['2026-06', 'העברה מב.ד.ס.י. השקעות - משכורת הבראה'], ['2026-08', 'העברה מב.ד.ס.י. השקעות - השלמה']]
    .forEach(([m, d]) => txns.push(txn(m, d, 2500, 'הכנסות', { day: 20 })))
  save(db, txns)
  const rows = windowRows(db, MONTHS)
  const c = incomeComposition(rows, MONTHS, INCOME)
  const by = Object.fromEntries(c.sources.map(x => [x.description, x]))
  assert.strictEqual(by['משכורת פועלים'].kind, 'regular')
  assert.strictEqual(by['משכורת פועלים'].typical, 12000)            // one salary a month, not 7/6 or 1.5
  assert.strictEqual(by['משכורת פועלים'].jitter, true)
  assert.strictEqual(by['משכורת פועלים'].monthsPresent, 4)
  assert.strictEqual(by['זיכוי זהב מעצמי'].kind, 'one-off')
  assert.strictEqual(by['זיכוי זהב מעצמי'].typical, 0)
  assert.strictEqual(by['חשבונית לקוח'].kind, 'irregular')
  assert.strictEqual(by['חשבונית לקוח'].typical, 1000)              // 6000 / 6
  assert.strictEqual(by['cashback'].kind, 'irregular')
  assert.strictEqual(by['cashback'].typical, 150)                    // 18 × 50 / 6
  const company = c.sources.find(x => x.description.startsWith('העברה מב.ד.ס.י'))
  assert.strictEqual(company.payments, 4)                            // four memos, one payer
  assert.strictEqual(company.kind, 'irregular')                      // 4 payments < N−1
  assert.ok(Math.abs(company.typical - 10000 / 6) < 1e-9)
  assert.strictEqual(c.sources.filter(x => x.description.startsWith('העברה מב.ד.ס.י')).length, 1)
  assert.ok(Math.abs(c.typicalIncome - (12000 + 1000 + 150 + 10000 / 6)) < 1e-9)
  assert.deepStrictEqual(c.oneOff.items.map(x => x.description), ['זיכוי זהב מעצמי'])
  assert.strictEqual(c.oneOff.total, 40000)
  assert.strictEqual(c.hasJitter, true)
  assert.strictEqual(c.sources[0].description, 'משכורת פועלים')       // biggest first
  assert.ok(Math.abs(c.sources[0].share - 84000 / (84000 + 40000 + 6000 + 900 + 10000)) < 1e-9)

  // The representative month uses the typical income, not the lumpy median.
  const totals = monthlyTotals(rows, MONTHS, INCOME)
  const rep = representativeMonth(totals, c)
  assert.ok(Math.abs(rep.income - c.typicalIncome) < 1e-9)
  assert.ok(rep.median.income !== rep.income)                        // raw median is distorted (0/2-salary months)
  assert.strictEqual(rep.net, rep.income - rep.expenses)
  assert.strictEqual(rep.annualizedNet, rep.net * 12)
  assert.strictEqual(rep.incomeJitter, true)
  assert.strictEqual(rep.oneOffIncome.total, 40000)
  // ...and the structure verdict is judged against the same income.
  const rec = detectRecurring(rows, MONTHS, INCOME)
  const st = spendingStructure(rows, MONTHS, INCOME, totals, rec, c.typicalIncome)
  assert.ok(Math.abs(st.income - c.typicalIncome) < 1e-9)
})

test('income composition: with a short window a single payment is not treated as one-off', () => {
  const db = freshDb()
  const three = MONTHS.slice(-3)
  save(db, [txn('2026-08', 'בונוס', 3000, 'הכנסות')])
  const c = incomeComposition(windowRows(db, three), three, INCOME)
  assert.strictEqual(c.sources[0].kind, 'irregular')
  assert.strictEqual(c.sources[0].typical, 1000)
})

test('representative month: a flat family is stable, a wild one is volatile', () => {
  const flat = [1, 2, 3, 4, 5, 6].map(i => ({ month: `2026-0${i}`, income: 10000, expenses: 8000 + i, net: 2000 - i }))
  assert.strictEqual(representativeMonth(flat).volatility.level, 'stable')
  assert.strictEqual(representativeMonth(flat).volatility.pattern, 'stable')
  const wild = [1, 2, 3, 4, 5, 6].map(i => ({ month: `2026-0${i}`, income: 10000, expenses: i % 2 ? 4000 : 12000, net: 0 }))
  assert.strictEqual(representativeMonth(wild).volatility.level, 'volatile')
  assert.strictEqual(representativeMonth(wild).volatility.pattern, 'every-month')
  assert.strictEqual(representativeMonth([]).enough, false)
})

// ---------------------------------------------------------------------------
test('recurring: monthly bill, bi-monthly bill detected; weekly groceries and installments are not', () => {
  const db = freshDb()
  normalFamily(db)
  save(db, MONTHS.map((m, i) => inst(m, 'טלוויזיה', 200, i + 1, 12, 2400)))
  const rows = windowRows(db, MONTHS)
  const rec = detectRecurring(rows, MONTHS, INCOME)
  assert.ok(rec.enough)
  const byDesc = Object.fromEntries(rec.merchants.map(m => [normalizeMerchant(m.description), m]))
  assert.strictEqual(byDesc[normalizeMerchant('שכר דירה')].kind, 'monthly')
  assert.strictEqual(byDesc[normalizeMerchant('פלאפון 050')].kind, 'monthly')      // varying amount still monthly
  assert.strictEqual(byDesc[normalizeMerchant('מי אביבים')].kind, 'periodic')      // every other month, stable
  assert.strictEqual(byDesc[normalizeMerchant('מי אביבים')].avgPerMonth, 200)      // 3 × 400 spread over 6 months
  assert.ok(!byDesc[normalizeMerchant('שופרסל דיל')], 'groceries (12 visits/month) must not be fixed')
  assert.ok(!byDesc[normalizeMerchant('טלוויזיה')], 'installments are not recurring merchants')
  // Fixed per month = rent + phone (+ water on even months)
  assert.strictEqual(rec.byMonth.get('2026-03'), 6000 + 100 + 400)
  assert.strictEqual(rec.byMonth.get('2026-04'), 6000 + 101)
})

test('recurring changes: a vanished subscription, a new one, and a price increase', () => {
  const db = freshDb()
  normalFamily(db)
  const txns = []
  MONTHS.slice(0, 4).forEach(m => txns.push(txn(m, 'נטפליקס', -50, 'בידור')))          // gone after June
  MONTHS.slice(3).forEach(m => txns.push(txn(m, 'ספוטיפיי', -30, 'בידור')))             // new since June
  MONTHS.forEach((m, i) => txns.push(txn(m, 'ביטוח רכב', -(i === 5 ? 460 : 400), 'ביטוח ופיננסים')))  // +15% in Aug
  save(db, txns)
  const rec = detectRecurring(windowRows(db, MONTHS), MONTHS, INCOME)
  assert.deepStrictEqual(rec.changes.gone.map(x => x.description), ['נטפליקס'])
  assert.strictEqual(rec.changes.gone[0].lastSeen, '2026-06')
  assert.deepStrictEqual(rec.changes.new.map(x => x.description), ['ספוטיפיי'])
  assert.strictEqual(rec.changes.new[0].since, '2026-06')
  assert.deepStrictEqual(rec.changes.increased.map(x => x.description), ['ביטוח רכב'])
  assert.strictEqual(rec.changes.increased[0].from, 400)
  assert.strictEqual(rec.changes.increased[0].to, 460)
})

test('recurring: habits are not obligations — a monthly restaurant is not fixed, an identical meal-kit is; irregular spacing is not periodic', () => {
  const db = freshDb(); normalFamily(db)
  const txns = []
  MONTHS.forEach((m, i) => txns.push(txn(m, 'מסעדת האחים', -(180 + i * 25), 'מסעדות')))       // every month, bills vary ±30%
  MONTHS.forEach(m => txns.push(txn(m, 'ארוחות בקופסה', -349, 'מזון')))                        // identical every month
  ;['2026-03', '2026-04', '2026-06', '2026-08'].forEach((m, i) => txns.push(txn(m, 'חנות ספרים', -[150, 230, 190, 260][i], 'קניות')))  // most months, varying
  ;['2026-03', '2026-05', '2026-07'].forEach(m => txns.push(txn(m, 'גז - סופרגז', -310, 'חשבונות בית')))       // bi-monthly bill
  save(db, txns)
  const rec = detectRecurring(windowRows(db, MONTHS), MONTHS, INCOME)
  const kinds = Object.fromEntries(rec.merchants.map(x => [x.description, x.kind]))
  assert.strictEqual(kinds['מסעדת האחים'], undefined)
  assert.strictEqual(kinds['ארוחות בקופסה'], 'monthly')
  assert.strictEqual(kinds['חנות ספרים'], undefined)
  assert.strictEqual(kinds['גז - סופרגז'], 'periodic')
})

test('recurring needs at least 3 months', () => {
  const db = freshDb(); normalFamily(db)
  const two = MONTHS.slice(-2)
  assert.strictEqual(detectRecurring(windowRows(db, two), two, INCOME).enough, false)
})

// ---------------------------------------------------------------------------
function structureFor(db, months = MONTHS) {
  const rows = windowRows(db, months)
  const totals = monthlyTotals(rows, months, INCOME)
  const rec = detectRecurring(rows, months, INCOME)
  return spendingStructure(rows, months, INCOME, totals, rec)
}

test('structure: balanced family — fixed + variable below income', () => {
  const db = freshDb(); normalFamily(db)                 // income 20,000, expenses ~10,100
  const s = structureFor(db)
  assert.strictEqual(s.verdict, 'balanced')
  assert.strictEqual(s.income, 20000)
  assert.ok(s.gap > 0)
  assert.ok(Math.abs(s.fixed.total - (6000 + 102.5 + 200)) < 1, `fixed ${s.fixed.total}`)   // rent + phone median + water median-ish
  assert.ok(s.variable.total > 3000)                                                        // groceries
  assert.strictEqual(s.variable.topCategories[0].category, 'מזון')
  assert.strictEqual(s.heavyFixed, false)
})

test('structure: deficit from rent alone is structural', () => {
  const db = freshDb(); normalFamily(db, { salary: 9000, rent: 6000 })   // fixed ≈ 6,300 of 9,000 = 70%
  const s = structureFor(db)
  assert.ok(s.gap < 0)
  assert.strictEqual(s.verdict, 'structural')
  assert.ok(s.fixed.share >= 0.6)
  assert.strictEqual(s.heavyFixed, true)
})

test('structure: deficit from groceries with low fixed share is behavioural', () => {
  const db = freshDb(); normalFamily(db, { salary: 9000, rent: 1500, groceriesPerVisit: 600, visits: 14 })  // fixed ≈ 1,800; variable 8,400
  const s = structureFor(db)
  assert.ok(s.gap < 0, `gap ${s.gap}`)
  assert.strictEqual(s.verdict, 'behavioral')
  assert.ok(s.leftAfterFixed > 0)
})

test('structure: no recorded income → no-income verdict', () => {
  const db = freshDb()
  save(db, MONTHS.map(m => txn(m, 'שכר דירה', -6000, 'חשבונות בית')))
  assert.strictEqual(structureFor(db).verdict, 'no-income')
})

test('structure: installments count as fixed', () => {
  const db = freshDb(); normalFamily(db)
  save(db, MONTHS.map((m, i) => inst(m, 'טלוויזיה', 200, i + 1, 12, 2400)))
  const s = structureFor(db)
  assert.strictEqual(s.fixed.installments, 200)
  assert.ok(s.fixed.total > 6400)
})

// ---------------------------------------------------------------------------
test('drivers: amount and frequency, many-small vs few-large, over-budget ranking', () => {
  const db = freshDb(); normalFamily(db)                 // groceries: 12 × 300 = 3,600/month, many-small
  setBudget(db, 'מזון', 3000)                            // → over by 600 each month
  setBudget(db, 'חשבונות בית', 7000)                     // rent 6000 (+400 water on even months) → under
  const rows = windowRows(db, MONTHS)
  const limits = effectiveLimitsByMonth(db, MONTHS)
  const d = gapDrivers(rows, MONTHS, INCOME, limits)
  const food = d.categories.find(c => c.category === 'מזון')
  assert.strictEqual(food.avgPerMonth, 3600)
  assert.strictEqual(food.countPerMonth, 12)
  assert.strictEqual(food.avgTicket, 300)
  assert.strictEqual(food.pattern, 'many-small')
  assert.strictEqual(food.budgetAvg, 3000)
  assert.strictEqual(food.overAvg, 600)
  assert.strictEqual(food.monthsOver, 6)
  const home = d.categories.find(c => c.category === 'חשבונות בית')
  assert.strictEqual(home.pattern, 'few-large')
  assert.strictEqual(home.overAvg, 0)
  assert.strictEqual(d.top[0].category, 'חשבונות בית')          // biggest by amount
  assert.deepStrictEqual(d.overBudget.map(c => c.category), ['מזון'])
  const phone = d.categories.find(c => c.category === 'תקשורת ואפליקציות')
  assert.strictEqual(phone.budgetAvg, null)                       // never budgeted
})

// ---------------------------------------------------------------------------
test('budget realism: wishful, loose, realistic; income targets skipped', () => {
  const db = freshDb(); normalFamily(db)
  setBudget(db, 'מזון', 2500)               // spend 3,600 every month → wishful
  setBudget(db, 'תקשורת ואפליקציות', 500)              // spend ~100 → loose
  setBudget(db, 'חשבונות בית', 6300)        // 6000 / 6400 alternating → over 3 of 6, median 6200 → realistic
  setBudget(db, 'הכנסות', 20000)            // income target, must be ignored
  const rows = windowRows(db, MONTHS)
  const r = budgetRealism(rows, MONTHS, INCOME, effectiveLimitsByMonth(db, MONTHS))
  const by = Object.fromEntries(r.rows.map(x => [x.category, x]))
  assert.strictEqual(by['מזון'].verdict, 'wishful')
  assert.strictEqual(by['מזון'].monthsOver, 6)
  assert.strictEqual(by['מזון'].suggested, 3600)
  assert.strictEqual(by['תקשורת ואפליקציות'].verdict, 'loose')
  assert.ok(by['תקשורת ואפליקציות'].suggested < 500 && by['תקשורת ואפליקציות'].suggested >= 100)
  assert.strictEqual(by['חשבונות בית'].verdict, 'realistic')
  assert.strictEqual(by['הכנסות'], undefined)
  assert.deepStrictEqual(r.summary, { wishful: 1, loose: 1, realistic: 1, planningGap: 3600 - 2500 })
  assert.strictEqual(r.rows[0].category, 'מזון')                 // biggest gap first
})

test('budget realism: a budget that starts mid-window counts only from its start', () => {
  const db = freshDb(); normalFamily(db)
  setBudget(db, 'מזון', 2500, '', '2026-06')                  // only Jun–Aug → 3 of 6 months, still ≥ half
  const r = budgetRealism(windowRows(db, MONTHS), MONTHS, INCOME, effectiveLimitsByMonth(db, MONTHS))
  assert.strictEqual(r.rows[0].monthsBudgeted, 3)
  setBudget(db, 'מזון', 2500, '', '2026-08')                  // only Aug → below half → dropped
  const r2 = budgetRealism(windowRows(db, MONTHS), MONTHS, INCOME, effectiveLimitsByMonth(db, MONTHS))
  assert.strictEqual(r2.rows.length, 0)
})

// ---------------------------------------------------------------------------
function progressFor(db, months = MONTHS) {
  const rows = windowRows(db, months)
  return progress(rows, months, INCOME, effectiveLimitsByMonth(db, months), monthlyTotals(rows, months, INCOME))
}

test('progress: expenses fall in the recent half → improving, with movers and breaches', () => {
  const db = freshDb()
  const txns = []
  MONTHS.forEach((m, i) => {
    txns.push(txn(m, 'משכורת', 15000, 'הכנסות'))
    txns.push(txn(m, 'שכר דירה', -5000, 'חשבונות בית'))
    const shopping = i < 3 ? 3000 : 1500                          // halved from June
    txns.push(txn(m, 'זארה', -shopping, 'קניות'))
    txns.push(txn(m, 'לא ידוע', -(i < 3 ? 1000 : 200), 'אחר'))    // less uncategorised lately
  })
  save(db, txns)
  setBudget(db, 'קניות', 2000)                                      // breached only in the first half
  const p = progressFor(db)
  assert.ok(p.enough)
  assert.deepStrictEqual(p.recent.months, ['2026-06', '2026-07', '2026-08'])
  assert.deepStrictEqual(p.previous.months, ['2026-03', '2026-04', '2026-05'])
  assert.strictEqual(p.previous.expenses, 9000)
  assert.strictEqual(p.recent.expenses, 6700)
  assert.strictEqual(p.verdict, 'improving')
  assert.strictEqual(p.previous.breachesPerMonth, 1)
  assert.strictEqual(p.recent.breachesPerMonth, 0)
  assert.ok(p.delta.otherShare < 0)
  assert.deepStrictEqual(p.movers.down.map(mv => mv.category), ['קניות', 'אחר'])
  assert.strictEqual(p.movers.up.length, 0)
})

test('progress: rising expenses → worsening; too few months → not enough', () => {
  const db = freshDb()
  const txns = []
  MONTHS.forEach((m, i) => {
    txns.push(txn(m, 'משכורת', 15000, 'הכנסות'))
    txns.push(txn(m, 'קניות', -(i < 3 ? 5000 : 7000), 'קניות'))
  })
  save(db, txns)
  assert.strictEqual(progressFor(db).verdict, 'worsening')
  assert.strictEqual(progressFor(db, MONTHS.slice(-3)).enough, false)
})

test('progress: a one-off income in the recent half does not count as improvement', () => {
  const db = freshDb(); normalFamily(db)
  save(db, [txn('2026-07', 'העברה מחיסכון', 30000, 'הכנסות')])
  const rows = windowRows(db, MONTHS)
  const totals = monthlyTotals(rows, MONTHS, INCOME)
  const limits = effectiveLimitsByMonth(db, MONTHS)
  const naive = progress(rows, MONTHS, INCOME, limits, totals)
  assert.strictEqual(naive.verdict, 'improving')                     // fooled by the transfer
  const c = incomeComposition(rows, MONTHS, INCOME)
  const p = progress(rows, MONTHS, INCOME, limits, totals, new Set(c.oneOff.items.map(i => i.key)))
  assert.strictEqual(p.verdict, 'flat')
  assert.strictEqual(p.recent.income, 20000)
  const e2e = computeInsights(db, { monthsBack: 6, now: NOW })
  assert.strictEqual(e2e.progress.verdict, 'flat')
})

test('progress: same spending both halves → flat', () => {
  const db = freshDb(); normalFamily(db)
  assert.strictEqual(progressFor(db).verdict, 'flat')
})

// ---------------------------------------------------------------------------
test('periodic: big one-offs are collected into a monthly set-aside; recurring and small ones are not', () => {
  const db = freshDb(); normalFamily(db)
  save(db, [
    txn('2026-04', 'ביטוח דירה שנתי', -2400, 'ביטוח ופיננסים'),
    txn('2026-07', 'טיפול 30,000 מוסך', -1800, 'רכב'),
    txn('2026-05', 'מתנה קטנה', -80, 'קניות'),                    // too small
  ])
  const rows = windowRows(db, MONTHS)
  const rec = detectRecurring(rows, MONTHS, INCOME)
  const avgExpenses = monthlyTotals(rows, MONTHS, INCOME).reduce((s, t) => s + t.expenses, 0) / 6
  const p = periodicExpenses(rows, MONTHS, INCOME, rec, avgExpenses)
  assert.ok(p.enough)
  assert.deepStrictEqual(p.items.map(i => i.description), ['ביטוח דירה שנתי', 'טיפול 30,000 מוסך'])
  assert.strictEqual(p.total, 4200)
  assert.strictEqual(p.perMonth, 700)
  assert.strictEqual(p.provision, 700)
  assert.deepStrictEqual(p.items[0].months, ['2026-04'])
  assert.strictEqual(p.items[0].txns.length, 1)
  assert.deepStrictEqual(p.coverage, { months: MONTHS, from: '2026-03', to: '2026-08' })
  // Rent is recurring, groceries are frequent → neither appears
  assert.ok(!p.items.some(i => i.category === 'חשבונות בית' || i.category === 'מזון'))
})

test('periodic: threshold scales with spending and the same merchant twice still counts', () => {
  const db = freshDb(); normalFamily(db, { groceriesPerVisit: 3000 })   // avg expenses ≈ 42,000 → threshold 630
  save(db, [txn('2026-04', 'וטרינר', -500, 'אחר'), txn('2026-06', 'וטרינר', -500, 'אחר')])   // 2 months, total 1000
  const rows = windowRows(db, MONTHS)
  const rec = detectRecurring(rows, MONTHS, INCOME)
  const avg = monthlyTotals(rows, MONTHS, INCOME).reduce((s, t) => s + t.expenses, 0) / 6
  const p = periodicExpenses(rows, MONTHS, INCOME, rec, avg)
  assert.ok(p.threshold > 600 && p.threshold < 700, `threshold ${p.threshold}`)
  // 500 < threshold but the two visits together (1000) pass 2×threshold? 1000 < 1260 → excluded
  assert.ok(!p.items.some(i => i.description === 'וטרינר'))
})

// ---------------------------------------------------------------------------
test('installments: plan reconstruction, schedule, ending soon, new plans', () => {
  const db = freshDb()
  // Plan A: 12 × 200, seen #4..#9 in Mar..Aug → 3 left → ends 2026-11
  save(db, MONTHS.map((m, i) => inst(m, 'טלוויזיה', 200, i + 4, 12, 2400)))
  // Plan B: 3 × 500, seen #1..#3 in Jun..Aug → finished
  save(db, ['2026-06', '2026-07', '2026-08'].map((m, i) => inst(m, 'נעליים', 500, i + 1, 3, 1500)))
  // Plan C: 10 × 100 seen #1..#2 in Aug, Sep (card reports next month early) → ends 2027-05
  save(db, [inst('2026-08', 'ריהוט', 100, 1, 10, 1000), inst('2026-09', 'ריהוט', 100, 2, 10, 1000)])
  // Plan D: stale — 6 × 300, #1..#2 in Mar, Apr, never seen again
  save(db, [inst('2026-03', 'מזגן', 300, 1, 6, 1800), inst('2026-04', 'מזגן', 300, 2, 6, 1800)])
  // Unknown: installment without a parsed number
  save(db, [txn('2026-08', 'משהו', -150, 'קניות', { type: 'installments' })])

  const r = installmentsInsight(db, { now: NOW, windowMonths: MONTHS, incomeMedian: 10000 })
  const by = Object.fromEntries(r.plans.map(p => [p.description, p]))
  assert.deepStrictEqual(Object.keys(by).sort(), ['טלוויזיה', 'ריהוט'])
  assert.strictEqual(by['טלוויזיה'].paid, 9)
  assert.strictEqual(by['טלוויזיה'].remaining, 3)
  assert.strictEqual(by['טלוויזיה'].remainingAmount, 600)
  assert.strictEqual(by['טלוויזיה'].endMonth, '2026-11')
  assert.strictEqual(by['טלוויזיה'].startMonth, '2025-12')
  assert.strictEqual(by['ריהוט'].endMonth, '2027-05')
  assert.strictEqual(by['ריהוט'].remaining, 8)

  assert.deepStrictEqual(r.stalePlans.map(p => p.description), ['מזגן'])
  assert.deepStrictEqual(r.finishedRecently.map(p => p.description), ['נעליים'])
  assert.deepStrictEqual(r.unknown, { count: 1, total: 150 })

  // Schedule: Sep..Nov = TV 200 + furniture 100; Dec..May = furniture only
  assert.strictEqual(r.schedule[0].month, '2026-09')
  assert.strictEqual(r.schedule[0].amount, 300)
  assert.strictEqual(r.schedule[2].month, '2026-11')
  assert.strictEqual(r.schedule[2].amount, 300)
  assert.strictEqual(r.schedule[2].ending, 1)
  assert.strictEqual(r.schedule[3].amount, 100)
  assert.strictEqual(r.schedule[8].month, '2027-05')
  assert.strictEqual(r.schedule[8].amount, 100)
  assert.strictEqual(r.schedule[9].amount, 0)
  assert.strictEqual(r.monthlyBurden, 300)
  assert.strictEqual(r.shareOfIncome, 0.03)
  assert.strictEqual(r.remainingDebt, 600 + 800)
  assert.deepStrictEqual(r.endingSoon.map(p => p.description), ['טלוויזיה'])
  // Plans opened inside the window: shoes (Jun), furniture (Aug), AC (Mar) — not the TV (Dec 2025)
  assert.strictEqual(r.newInWindow.count, 3)
  assert.strictEqual(r.newInWindow.total, 1500 + 1000 + 1800)
})

test('installments: two identical purchases are counted twice; liabilities from the assets sheet', () => {
  const db = freshDb()
  save(db, [inst('2026-08', 'טיסה', 400, 1, 5, 2000), inst('2026-08', 'טיסה', 400, 1, 5, 2000)])   // two tickets
  db.prepare(`INSERT INTO financial_assets (id, kind, institution, asset_type, label, currency) VALUES (7, 'liability', 'בנק', 'הלוואה', 'הלוואת רכב', 'ILS')`).run()
  db.prepare(`INSERT INTO asset_snapshots (asset_id, snapshot_date, balance) VALUES (7, '2026-06-01', 50000), (7, '2026-08-01', 45000)`).run()
  const r = installmentsInsight(db, { now: NOW, windowMonths: MONTHS })
  assert.strictEqual(r.plans.length, 1)
  assert.strictEqual(r.plans[0].multiplicity, 2)
  assert.strictEqual(r.plans[0].perMonth, 800)
  assert.strictEqual(r.plans[0].originalAmount, 4000)
  assert.strictEqual(r.monthlyBurden, 800)
  assert.strictEqual(r.shareOfIncome, null)                       // no income given
  assert.strictEqual(r.liabilities.length, 1)
  assert.strictEqual(r.liabilities[0].balance, 45000)             // latest snapshot
  assert.strictEqual(r.liabilitiesTotal, 45000)
})

// ---------------------------------------------------------------------------
test('computeInsights: end-to-end over a fixture, JSON-serialisable, window respected', () => {
  const db = freshDb(); normalFamily(db)
  save(db, [txn('2026-09', 'current month', -50, 'מזון')])
  const r = computeInsights(db, { monthsBack: 6, now: NOW })
  assert.deepStrictEqual(r.window.months, MONTHS)
  assert.strictEqual(r.window.currentMonth, '2026-09')
  assert.strictEqual(r.representative.median.income, 20000)
  assert.strictEqual(r.representative.income, 20000)                 // regular salary → typical = median
  assert.strictEqual(r.structure.verdict, 'balanced')
  assert.ok(r.structure.recurring.merchants.length >= 3)
  assert.ok(Array.isArray(r.drivers.top))
  assert.ok(r.progress.enough)
  assert.ok(r.installments.schedule.length === 12)
  const json = JSON.parse(JSON.stringify(r))                       // Sets/Maps must not leak
  assert.strictEqual(json.structure.recurring.recurringKeys, undefined)
  assert.strictEqual(json.structure.recurring.byMonth, undefined)
  assert.strictEqual(json.installments.plans.every(p => p.observedMonths === undefined), true)
  const all = computeInsights(db, { monthsBack: 'all', now: NOW })
  assert.deepStrictEqual(all.window.months, MONTHS)
  const short = computeInsights(db, { monthsBack: 2, now: NOW })
  assert.strictEqual(short.representative.enough, false)
  assert.strictEqual(short.progress.enough, false)
})

test('computeInsights: excluded accounts, transfers and excluded categories stay out', () => {
  const db = freshDb(); normalFamily(db)
  db.prepare(`INSERT INTO accounts (id,name,source,owner,credentials,include_in_totals) VALUES (2,'X','cal','Mom','x',0)`).run()
  saveAccountTransactions({ id: 2, name: 'X', source: 'cal', owner: 'Mom' }, { accountNumber: '9', txns: [txn('2026-06', 'huge', -99999, 'קניות')] }, db)
  save(db, [txn('2026-06', 'CC repayment', -8000, 'הורדת כרטיס אשראי'), txn('2026-06', 'transfer', -7000, 'מזון')])
  db.prepare(`INSERT INTO categories (name, is_excluded) VALUES ('הורדת כרטיס אשראי', 1)`).run()
  db.prepare(`UPDATE transactions SET is_transfer = 1 WHERE description = 'transfer'`).run()
  const r = computeInsights(db, { monthsBack: 6, now: NOW })
  const june = r.representative.months.find(t => t.month === '2026-06')
  const april = r.representative.months.find(t => t.month === '2026-04')   // like June: no water bill
  assert.ok(Math.abs(june.expenses - april.expenses) < 10, `june ${june.expenses} vs april ${april.expenses}`)
})

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
