/**
 * Account balances — the latest balance per account/card from the last scrape.
 * Banks return a real balance; credit cards usually don't (stored as null).
 */

import { getDb } from './database.js'
import { notExcludedSql } from './subaccounts.js'

/** Insert or update the balance for one account number. */
export function upsertBalance(db, accountId, accountNumber, balance, dateISO) {
  db.prepare(`
    INSERT INTO account_balances (account_id, account_number, balance, balance_date)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(account_id, account_number)
    DO UPDATE SET balance = excluded.balance,
                  balance_date = excluded.balance_date,
                  updated_at = datetime('now')
  `).run(accountId, accountNumber, balance == null ? null : Number(balance), dateISO)
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
