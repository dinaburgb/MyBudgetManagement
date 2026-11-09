/**
 * Demo server — boots the REAL app on a throwaway data folder filled with FAKE
 * data, so the UI (and especially the Insights page) can be checked by eye
 * without touching the real database or entering the real master password.
 *
 *   node tests/demo-server.mjs          → http://localhost:3777, already unlocked
 *   PORT=4000 node tests/demo-server.mjs
 *
 * Everything lives under <os temp>/myfinance-demo and is wiped on every start.
 * The unlock uses a hardcoded throwaway password; there are no bank credentials.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const dir = path.join(os.tmpdir(), 'myfinance-demo')
fs.rmSync(dir, { recursive: true, force: true })
fs.mkdirSync(dir, { recursive: true })
process.env.MYFINANCE_DATA_DIR = dir
process.env.MYFINANCE_CRYPTO_DIR = dir
process.env.NO_OPEN = '1'
process.env.PORT = process.env.PORT || '3777'

// Import lazily so the env above is in place before database.js reads it.
const { DatabaseSync } = await import('node:sqlite')
const { SCHEMA_SQL } = await import('../server/db/schema.js')
const { seedCategories } = await import('../server/db/categories.js')
const { saveAccountTransactions } = await import('../server/db/save-transactions.js')
const { setBudget } = await import('../server/db/budgets.js')

// ---------------------------------------------------------------------------
// Fake data: 8 complete months (Jan–Aug 2026) + a partial September.
// ---------------------------------------------------------------------------

let seed = 42
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
const between = (a, b) => a + rnd() * (b - a)
const pick = arr => arr[Math.floor(rnd() * arr.length)]
const MONTHS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']
const complete = m => m !== '2026-09'

function t(month, day, description, amount, category, extra = {}) {
  const date = `${month}-${String(day).padStart(2, '0')}T00:00:00.000Z`
  return { type: 'normal', date, processedDate: date, originalAmount: amount, originalCurrency: 'ILS',
           chargedAmount: amount, chargedCurrency: 'ILS', description, status: 'completed', category, ...extra }
}
function inst(month, day, description, perMonth, number, total, full, category = 'קניות') {
  return t(month, day, description, -perMonth, category, { type: 'installments', installments: { number, total }, originalAmount: -full })
}

const bank = { id: 1, name: 'בנק — משותף', source: 'discount', owner: 'Boris' }
const card = { id: 2, name: 'כרטיס אשראי', source: 'max', owner: 'Irena' }

const bankTxns = [], cardTxns = []
MONTHS.forEach((m, i) => {
  const partial = !complete(m)
  const maxDay = partial ? 12 : 28
  // Income
  // Salary normally on the 1st; in May it landed on April 30th (a real-life timing quirk)
  if (m === '2026-05') bankTxns.push(t('2026-04', 30, 'משכורת - חברת הייטק בע"מ', 14200, 'הכנסות'))
  else bankTxns.push(t(m, 1, 'משכורת - חברת הייטק בע"מ', 14200, 'הכנסות'))
  if (!partial) bankTxns.push(t(m, 10, 'משכורת - עיריית ת"א', 9600, 'הכנסות'))
  // Fixed bills (bank)
  bankTxns.push(t(m, 2, 'משכנתא בנק מזרחי', -5800, 'הלוואות ומשכנתאות'))
  bankTxns.push(t(m, 3, 'הראל ביטוח - חיים ודירה', -620, 'ביטוח ופיננסים'))
  bankTxns.push(t(m, 5, 'חברת החשמל 12345', -Math.round(between(380, 920)), 'חשבונות בית'))
  if (i % 2 === 0) bankTxns.push(t(m, 6, 'מי אביבים 2010', -380, 'חשבונות בית'))
  if (i % 2 === 1) bankTxns.push(t(m, 7, 'עיריית תל אביב - ארנונה', -1120, 'חשבונות בית'))
  if (!partial && m < '2026-07') bankTxns.push(t(m, 8, 'חוגים - מתנ"ס', -900, 'ילדים'))   // stops in summer
  // Fixed bills (card)
  cardTxns.push(t(m, 4, 'פלאפון 054-1234567', -89, 'תקשורת ואפליקציות'))
  cardTxns.push(t(m, 4, 'סלקום 052-7654321', -79, 'תקשורת ואפליקציות'))
  cardTxns.push(t(m, 9, 'פרטנר אינטרנט', -99.9, 'תקשורת ואפליקציות'))
  cardTxns.push(t(m, 11, 'הולמס פלייס', -249, 'בריאות'))
  if (m >= '2026-06') cardTxns.push(t(m, 12, 'NETFLIX.COM', -54.9, 'בידור'))              // new since June
  if (m <= '2026-06') cardTxns.push(t(m, 12, 'SPOTIFY', -29.9, 'בידור'))                  // gone after June
  cardTxns.push(t(m, 13, 'ביטוח רכב - כלל', -(m === '2026-08' ? 455 : 395), 'ביטוח ופיננסים'))   // price hike in Aug
  // Variable: groceries, fuel, restaurants, shopping, pharmacy
  const visits = Math.floor(between(11, 17)) * (partial ? 0.4 : 1)
  for (let v = 0; v < visits; v++) cardTxns.push(t(m, 1 + Math.floor(rnd() * maxDay), pick(['שופרסל דיל', 'רמי לוי', 'ויקטורי', 'AM:PM']) + ' ' + Math.floor(rnd() * 900), -Math.round(between(90, 520)), 'מזון'))
  for (let v = 0; v < (partial ? 2 : 4); v++) cardTxns.push(t(m, 1 + Math.floor(rnd() * maxDay), 'פז ' + Math.floor(rnd() * 400), -Math.round(between(240, 380)), 'רכב'))
  for (let v = 0; v < Math.floor(between(3, 7)) * (partial ? 0.4 : 1); v++) cardTxns.push(t(m, 1 + Math.floor(rnd() * maxDay), pick(['קפה גרג', 'מוזס', 'וולט', 'ג׳פניקה']), -Math.round(between(80, 320)), 'מסעדות'))
  for (let v = 0; v < Math.floor(between(2, 6)) * (partial ? 0.4 : 1); v++) cardTxns.push(t(m, 1 + Math.floor(rnd() * maxDay), pick(['ZARA', 'H&M', 'עזריאלי', 'AMAZON', 'ALIEXPRESS']), -Math.round(between(120, 700)), 'קניות'))
  cardTxns.push(t(m, 15, 'סופר פארם ' + Math.floor(rnd() * 100), -Math.round(between(60, 260)), 'בריאות'))
  if (!partial) cardTxns.push(t(m, 17, 'לא מסווג ' + i, -Math.round(between(100, 400)), 'אחר'))
})
// One-offs / periodic
bankTxns.push(t('2026-06', 12, 'זיכוי זה"ב מ-חשבון חיסכון', 15000, 'הכנסות'))     // own transfer filed as income
cardTxns.push(t('2026-03', 20, 'ד"ר כהן - רופא שיניים', -1500, 'בריאות'))
bankTxns.push(t('2026-04', 14, 'מגדל - ביטוח בריאות שנתי', -2400, 'ביטוח ופיננסים'))
cardTxns.push(t('2026-06', 21, 'מוסך רמי - טיפול 30,000', -1850, 'רכב'))
cardTxns.push(t('2026-07', 3, 'BOOKING.COM RHODES', -4200, 'נסיעות', { originalCurrency: 'EUR', originalAmount: -1050 }))
cardTxns.push(t('2026-07', 5, 'AEGEAN AIRLINES', -2900, 'נסיעות', { originalCurrency: 'EUR', originalAmount: -720 }))
cardTxns.push(t('2026-07', 8, 'TAVERNA NIKOS', -640, 'מסעדות', { originalCurrency: 'EUR', originalAmount: -160 }))
cardTxns.push(t('2026-08', 25, 'ציוד לבית הספר - קרביץ', -980, 'ילדים'))
// Installment plans
for (let i = 0; i < 9; i++) cardTxns.push(inst(MONTHS[i], 16, 'LG טלוויזיה - מחסני חשמל', 200, i + 4, 12, 2400))            // Dec 2025 → Nov 2026
for (let i = 3; i < 9; i++) cardTxns.push(inst(MONTHS[i], 18, 'iPhone - iDigital', 180, i - 2, 10, 1800))                    // Apr 2026 → Jan 2027
for (let i = 5; i < 8; i++) cardTxns.push(inst(MONTHS[i], 19, 'ELAL טיסות', 700, i - 4, 3, 2100, 'נסיעות'))                   // finished Aug
cardTxns.push(inst('2026-08', 22, 'IKEA', 450, 1, 6, 2700)); cardTxns.push(inst('2026-09', 22, 'IKEA', 450, 2, 6, 2700))     // new plan

// ---------------------------------------------------------------------------
// Build the throwaway database
// ---------------------------------------------------------------------------

const db = new DatabaseSync(path.join(dir, 'myfinance.db'))
db.exec(SCHEMA_SQL)
seedCategories(db)
for (const name of ['ילדים', 'הלוואות ומשכנתאות', 'הכנסות']) {
  db.prepare(`INSERT OR IGNORE INTO categories (name, color, is_income, sort_order) VALUES (?, ?, ?, 90)`).run(name, name === 'הכנסות' ? '#4ade80' : '#e879f9', name === 'הכנסות' ? 1 : 0)
}
for (const a of [bank, card]) {
  db.prepare(`INSERT INTO accounts (id, name, source, owner, credentials, include_in_totals, sort_order) VALUES (?,?,?,?,'',1,?)`).run(a.id, a.name, a.source, a.owner, a.id)
}
saveAccountTransactions(bank, { accountNumber: '100-200300', txns: bankTxns }, db)
saveAccountTransactions(card, { accountNumber: '1234', txns: cardTxns }, db)
for (const [cat, amt] of Object.entries({ 'מזון': 3000, 'רכב': 1500, 'קניות': 1200, 'מסעדות': 800, 'בידור': 400, 'חשבונות בית': 8000, 'תקשורת ואפליקציות': 600, 'בריאות': 500, 'ילדים': 1000, 'ביטוח ופיננסים': 1100, 'הלוואות ומשכנתאות': 5800, 'הכנסות': 24000 })) {
  setBudget(db, cat, amt)
}
db.prepare(`INSERT INTO financial_assets (id, kind, category, institution, asset_type, label, owner, currency) VALUES (1, 'liability', 'הלוואות', 'בנק מזרחי', 'הלוואה', 'הלוואת רכב', 'Joint', 'ILS')`).run()
db.prepare(`INSERT INTO asset_snapshots (asset_id, snapshot_date, balance) VALUES (1, '2026-06-01', 46000), (1, '2026-08-01', 42000)`).run()
db.close()
console.log(`Demo data written to ${dir} (${bankTxns.length + cardTxns.length} fake transactions)`)

// Boot the real server on the demo folder, then unlock with a throwaway password
// so the browser lands straight on the dashboard.
await import('../server/index.js')
const { unlockOrInit } = await import('../server/crypto/encryption.js')
console.log(`Demo unlock: ${unlockOrInit('demo-only-password')}`)
