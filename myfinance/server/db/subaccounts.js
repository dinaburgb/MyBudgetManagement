/**
 * Sub-account inclusion. One bank login (an `accounts` row) can expose several
 * account numbers; the user may want some counted in totals and others not.
 * Inclusion defaults to true; the `excluded_subaccounts` table lists only the
 * exceptions. The whole login's `include_in_totals` still applies on top — an
 * excluded login hides all of its numbers regardless of this table.
 */

import { getDb } from './database.js'

/**
 * SQL fragment: "this transaction's account number is NOT individually excluded".
 * Pass the column references for the account id and number in the surrounding
 * query (code-controlled identifiers, never user input). Combine with the
 * existing `include_in_totals = 1` login check.
 */
export function notExcludedSql(idCol, numberCol) {
  return `NOT EXISTS (SELECT 1 FROM excluded_subaccounts x
            WHERE x.account_id = ${idCol} AND x.account_number = ${numberCol})`
}

/**
 * List the account numbers seen under one login (from transactions and balances),
 * each with whether it's included, how many transactions it has, and its balance.
 */
export function listSubAccounts(db, accountId) {
  const rows = db.prepare(`
    SELECT account_number,
           COUNT(*)        AS txn_count,
           MIN(date)       AS first_date,
           MAX(date)       AS last_date
    FROM transactions
    WHERE account_id = ? AND account_number IS NOT NULL
    GROUP BY account_number
  `).all(accountId)

  const byNumber = new Map(rows.map(r => [r.account_number, { ...r, balance: null, balance_date: null }]))

  // Fold in balances (a number may have a balance but no transactions yet).
  for (const b of db.prepare(
    `SELECT account_number, balance, balance_date FROM account_balances WHERE account_id = ?`
  ).all(accountId)) {
    const existing = byNumber.get(b.account_number)
    if (existing) { existing.balance = b.balance; existing.balance_date = b.balance_date }
    else byNumber.set(b.account_number, { account_number: b.account_number, txn_count: 0, balance: b.balance, balance_date: b.balance_date })
  }

  const excluded = new Set(db.prepare(
    `SELECT account_number FROM excluded_subaccounts WHERE account_id = ?`
  ).all(accountId).map(r => r.account_number))

  return [...byNumber.values()]
    .map(s => ({ ...s, included: !excluded.has(s.account_number) }))
    .sort((a, b) => b.txn_count - a.txn_count)
}

/** Include or exclude one account number from totals. */
export function setSubAccountIncluded(db, accountId, accountNumber, include) {
  if (include) {
    db.prepare(`DELETE FROM excluded_subaccounts WHERE account_id = ? AND account_number = ?`)
      .run(accountId, accountNumber)
  } else {
    db.prepare(`INSERT OR IGNORE INTO excluded_subaccounts (account_id, account_number) VALUES (?, ?)`)
      .run(accountId, accountNumber)
  }
}

/** Whether a login has any individually-excluded numbers (for list badges). */
export function hasExcludedSubAccounts(db, accountId) {
  return !!db.prepare(`SELECT 1 FROM excluded_subaccounts WHERE account_id = ? LIMIT 1`).get(accountId)
}
