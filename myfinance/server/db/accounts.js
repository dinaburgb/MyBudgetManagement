/**
 * Account-level data operations.
 */

/**
 * Delete an account.
 *   withData=false → remove only the account row; its transactions stay as history.
 *   withData=true  → also delete the account's transactions and balances, so
 *                    nothing from this account appears anywhere ("clean account").
 * Returns { deletedTransactions }.
 */
export function deleteAccount(db, id, withData = false) {
  db.exec('BEGIN')
  try {
    let deletedTransactions = 0
    if (withData) {
      // Full clean: drop the account's transactions entirely.
      deletedTransactions = db.prepare(`DELETE FROM transactions WHERE account_id = ?`).run(id).changes
    } else {
      // Keep transactions as history, but detach them from the (soon gone) account
      // so they don't dangle on a foreign key and don't count in totals/net balance.
      db.prepare(`UPDATE transactions SET account_id = NULL WHERE account_id = ?`).run(id)
    }
    // Balances are account-specific and would otherwise skew the net balance.
    db.prepare(`DELETE FROM account_balances WHERE account_id = ?`).run(id)
    db.prepare(`DELETE FROM accounts WHERE id = ?`).run(id)
    db.exec('COMMIT')
    return { deletedTransactions }
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}
