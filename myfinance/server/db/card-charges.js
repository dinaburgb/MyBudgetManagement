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

/**
 * SQL fragment: "this card number is not one the user unticked". Written out
 * here rather than imported from subaccounts.js, which already imports this
 * module. The arguments are code-controlled column names, never user input.
 */
const notExcluded = (idCol, numberCol) => `NOT EXISTS (
    SELECT 1 FROM excluded_subaccounts x
     WHERE x.account_id = ${idCol} AND x.account_number = ${numberCol})`

/** 'YYYY-MM-DD' for today in local time. */
export function todayYmd(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** Turn a result row into { amount, date, txns }; amount > 0 = money leaving. */
function shape(row) {
  return { amount: -Number(row.total), date: row.charge_date, txns: row.txns }
}

/**
 * What each card login is about to be charged: every one of its cards' next
 * charges added together. Returns a Map:
 *   account_id -> { amount, from, to, cards, txns }
 * `amount` is positive when money leaves the account and negative when refunds
 * outweigh the charges. Logins with nothing coming up are absent from the map.
 *
 * Cards the user unticked in the breakdown are left out, so this figure means
 * the same thing as the balance next to a bank login. Built from
 * upcomingChargeByCard so the page adds up at every level: the total strip is
 * the sum of these, and each of these is the sum of the card rows under it.
 * When a login's cards sit on different charge dates `from` and `to` differ,
 * and the page shows the range rather than a single date.
 */
export function upcomingChargeByAccount(db = getDb(), today = todayYmd()) {
  const byAccount = new Map()
  for (const card of upcomingChargeByCard(db, today)) {
    if (!card.kept) continue
    const acc = byAccount.get(card.account_id)
    if (!acc) {
      byAccount.set(card.account_id, {
        amount: card.amount, from: card.date, to: card.date, cards: 1, txns: card.txns,
      })
      continue
    }
    acc.amount += card.amount
    acc.txns   += card.txns
    acc.cards  += 1
    if (card.date < acc.from) acc.from = card.date
    if (card.date > acc.to)   acc.to   = card.date
  }
  return byAccount
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

/**
 * Every card's next charge in one query, with two inclusion flags:
 *   kept     — the card number was not unticked in the breakdown. This is what
 *              the login figure sums, because the login's own include_in_totals
 *              is shown differently (greyed out) rather than by hiding it.
 *   included — kept AND the login counts toward totals. This is what the
 *              page-level total sums; the same rule the rest of the app uses.
 * Returns [{ account_id, account_number, date, amount, txns, kept, included }].
 */
export function upcomingChargeByCard(db = getDb(), today = todayYmd()) {
  return db.prepare(`
    WITH next AS (
      SELECT account_id, account_number, MIN(processed_date) AS charge_date
      FROM transactions
      WHERE source IN (${SRC}) AND account_id IS NOT NULL
        AND account_number IS NOT NULL AND processed_date >= ?
      GROUP BY account_id, account_number
    )
    SELECT n.account_id,
           n.account_number,
           n.charge_date                      AS charge_date,
           SUM(t.amount)                      AS total,
           COUNT(*)                           AS txns,
           CASE WHEN ${notExcluded('n.account_id', 'n.account_number')}
                THEN 1 ELSE 0 END             AS kept,
           CASE WHEN a.include_in_totals = 1
                 AND ${notExcluded('n.account_id', 'n.account_number')}
                THEN 1 ELSE 0 END             AS included
    FROM next n
    JOIN accounts a ON a.id = n.account_id
    JOIN transactions t ON t.account_id = n.account_id
                       AND t.account_number = n.account_number
                       AND t.processed_date = n.charge_date
                       AND t.source IN (${SRC})
    GROUP BY n.account_id, n.account_number
    ORDER BY n.charge_date, n.account_id, n.account_number
  `).all(...CARD_SOURCES, today, ...CARD_SOURCES).map(r => ({
    account_id: r.account_id,
    account_number: r.account_number,
    ...shape(r),
    kept: !!r.kept,
    included: !!r.included,
  }))
}

/**
 * What all the cards together are about to take out of the bank accounts:
 * each card's own next charge, added up over the cards that count toward
 * totals. Cards whose login is excluded, or that were unticked individually,
 * are reported separately in `skipped` instead of being silently dropped.
 *
 * Returns { amount, from, to, cards, txns, skipped: { cards, amount } };
 * `amount` is 0 and the dates null when no card has anything coming up.
 */
export function upcomingChargeTotal(db = getDb(), today = todayYmd()) {
  const rows = upcomingChargeByCard(db, today)
  const counted = rows.filter(r => r.included)
  const skipped = rows.filter(r => !r.included)
  const dates = counted.map(r => r.date).sort()
  return {
    amount: counted.reduce((sum, r) => sum + r.amount, 0),
    from: dates[0] || null,
    to: dates[dates.length - 1] || null,
    cards: counted.length,
    txns: counted.reduce((sum, r) => sum + r.txns, 0),
    skipped: {
      cards: skipped.length,
      amount: skipped.reduce((sum, r) => sum + r.amount, 0),
    },
  }
}
