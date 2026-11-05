/**
 * Upcoming credit-card charge — "סכום לחיוב הקרוב".
 *
 * Credit cards report no balance (account_balances keeps null for them), so the
 * number that actually matters for a card is how much the issuer is about to
 * debit from the bank account.
 *
 * Card scrapers give every transaction a processed_date = the day it will be
 * (or was) charged. So the next charge is simply:
 *   1. the earliest processed_date that is still today or later, and
 *   2. the net sum of every transaction carrying that date (refunds included).
 *
 * Only real card-source rows count. Manual entries (source 'manual') copy the
 * expense date into processed_date, which is not a charge date, so including
 * them would invent charges that never happen.
 *
 * Caveat worth knowing when reading the number: it is "what is known so far"
 * for that charge date. Purchases made later in the cycle keep landing on the
 * same date, so the amount grows until the card is actually charged.
 */

import { getDb } from './database.js'

/** Sources whose transactions are credit-card charges (same set as the client). */
export const CARD_SOURCES = ['cal', 'isracard', 'max']

const SRC = CARD_SOURCES.map(() => '?').join(',')

/** 'YYYY-MM-DD' for today in local time. */
export function todayYmd(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** Turn a result row into { amount, date, txns }; amount > 0 = money leaving. */
function shape(row) {
  return { amount: -Number(row.total), date: row.charge_date, txns: row.txns }
}

/**
 * The next charge per card login. Returns a Map:
 *   account_id -> { amount, date, txns }
 * `amount` is positive when money leaves the account (a charge) and negative
 * when the net is in the user's favour (refunds exceed charges on that date).
 * Logins with nothing charged ahead are simply absent from the map.
 */
export function upcomingChargeByAccount(db = getDb(), today = todayYmd()) {
  const rows = db.prepare(`
    WITH next AS (
      SELECT account_id, MIN(processed_date) AS charge_date
      FROM transactions
      WHERE source IN (${SRC}) AND account_id IS NOT NULL AND processed_date >= ?
      GROUP BY account_id
    )
    SELECT t.account_id,
           n.charge_date       AS charge_date,
           SUM(t.amount)       AS total,
           COUNT(*)            AS txns
    FROM transactions t
    JOIN next n ON n.account_id = t.account_id AND t.processed_date = n.charge_date
    WHERE t.source IN (${SRC})
    GROUP BY t.account_id
  `).all(...CARD_SOURCES, today, ...CARD_SOURCES)
  return new Map(rows.map(r => [r.account_id, shape(r)]))
}

/**
 * The next charge per card number under one login. Returns a Map:
 *   account_number -> { amount, date, txns }
 * Each card gets its own nearest charge date, so cards on different cycles
 * under the same login each report their own.
 */
export function upcomingChargeBySubAccount(db, accountId, today = todayYmd()) {
  const rows = db.prepare(`
    WITH next AS (
      SELECT account_number, MIN(processed_date) AS charge_date
      FROM transactions
      WHERE source IN (${SRC}) AND account_id = ?
        AND account_number IS NOT NULL AND processed_date >= ?
      GROUP BY account_number
    )
    SELECT t.account_number,
           n.charge_date       AS charge_date,
           SUM(t.amount)       AS total,
           COUNT(*)            AS txns
    FROM transactions t
    JOIN next n ON n.account_number = t.account_number AND t.processed_date = n.charge_date
    WHERE t.source IN (${SRC}) AND t.account_id = ?
    GROUP BY t.account_number
  `).all(...CARD_SOURCES, accountId, today, ...CARD_SOURCES, accountId)
  return new Map(rows.map(r => [r.account_number, shape(r)]))
}
