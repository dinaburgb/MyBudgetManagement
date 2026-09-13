/**
 * Account balances — the latest balance per account/card from the last scrape.
 * Banks return a real balance; credit cards usually don't (stored as null).
 */

import { getDb } from './database.js'
import { notExcludedSql } from './subaccounts.js'

/**
 * Insert or update the balance for one account number, and append it to the
 * per-day history (a second sync on the same day overwrites that day's row).
 * Null balances (credit cards) update the latest-balance row but leave no history.
 */
export function upsertBalance(db, accountId, accountNumber, balance, dateISO) {
  const value = balance == null ? null : Number(balance)
  db.prepare(`
    INSERT INTO account_balances (account_id, account_number, balance, balance_date)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(account_id, account_number)
    DO UPDATE SET balance = excluded.balance,
                  balance_date = excluded.balance_date,
                  updated_at = datetime('now')
  `).run(accountId, accountNumber, value, dateISO)
  if (value == null || !Number.isFinite(value)) return
  const day = localDay(dateISO)
  db.prepare(`
    INSERT INTO account_balance_history (account_id, account_number, day, balance, balance_date)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(account_id, account_number, day)
    DO UPDATE SET balance = excluded.balance, balance_date = excluded.balance_date
  `).run(accountId, accountNumber, day, value, dateISO)
}

/** 'YYYY-MM-DD' in local time for an ISO timestamp (falls back to today). */
function localDay(dateISO) {
  const d = dateISO ? new Date(dateISO) : new Date()
  const t = Number.isNaN(d.getTime()) ? new Date() : d
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
}

/**
 * Balance history for the included accounts, oldest first — the raw material for
 * a balance-over-time chart. Returns [{ day, account_id, account_number, balance }].
 */
export function balanceHistory(db = getDb(), accountIds = null) {
  const notExcluded = notExcludedSql('h.account_id', 'h.account_number')
  const where = accountIds && accountIds.length
    ? `h.account_id IN (${accountIds.map(() => '?').join(',')})`
    : `h.account_id IN (SELECT id FROM accounts WHERE include_in_totals = 1)`
  return db.prepare(`
    SELECT h.day, h.account_id, h.account_number, h.balance
    FROM account_balance_history h
    WHERE ${where} AND ${notExcluded}
    ORDER BY h.day, h.account_id, h.account_number
  `).all(...(accountIds && accountIds.length ? accountIds : []))
}

/**
 * Total balance per account row (summing its account numbers, ignoring nulls),
 * with the most recent balance_date. Returns a Map: account_id -> { balance, balance_date, hasBalance }.
 */
export function balancesByAccount(db = getDb()) {
  const rows = db.prepare(`
    SELECT account_id,
           SUM(balance)                       AS balance,
           MAX(balance_date)                  AS balance_date,
           SUM(CASE WHEN balance IS NOT NULL THEN 1 ELSE 0 END) AS withBalance
    FROM account_balances
    GROUP BY account_id
  `).all()
  return new Map(rows.map(r => [r.account_id, {
    balance: r.withBalance > 0 ? r.balance : null,
    balance_date: r.balance_date,
  }]))
}

/**
 * Net balance: sum of all known balances across the given account ids
 * (or all accounts when ids is null/empty).
 */
export function netBalance(db, accountIds = null) {
  // Individually-excluded account numbers don't count toward the net balance.
  const notExcluded = notExcludedSql('account_balances.account_id', 'account_balances.account_number')
  if (accountIds && accountIds.length) {
    const placeholders = accountIds.map(() => '?').join(',')
    return db.prepare(
      `SELECT SUM(balance) AS net FROM account_balances
       WHERE account_id IN (${placeholders}) AND ${notExcluded}`
    ).get(...accountIds).net || 0
  }
  return db.prepare(`SELECT SUM(balance) AS net FROM account_balances WHERE ${notExcluded}`).get().net || 0
}
