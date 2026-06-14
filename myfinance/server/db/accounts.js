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
/**
 * Move an account one step up or down in the manual display order by swapping its
 * sort_order with the adjacent neighbour. `direction` is 'up' or 'down'. Returns
 * true if a swap happened, false if the account is already at the edge.
 */
export function moveAccount(db, id, direction) {
  const me = db.prepare(`SELECT id, sort_order FROM accounts WHERE id = ?`).get(id)
  if (!me) return false
  // 'up' = appears higher in the list = a smaller sort_order. Find the closest
  // neighbour on that side. Tie-break on id so equal sort_orders still move.
  const neighbour = direction === 'up'
    ? db.prepare(`SELECT id, sort_order FROM accounts
                  WHERE sort_order < ? OR (sort_order = ? AND id < ?)
                  ORDER BY sort_order DESC, id DESC LIMIT 1`).get(me.sort_order, me.sort_order, me.id)
    : db.prepare(`SELECT id, sort_order FROM accounts
                  WHERE sort_order > ? OR (sort_order = ? AND id > ?)
                  ORDER BY sort_order ASC, id ASC LIMIT 1`).get(me.sort_order, me.sort_order, me.id)
  if (!neighbour) return false

  db.exec('BEGIN')
  try {
    db.prepare(`UPDATE accounts SET sort_order = ? WHERE id = ?`).run(neighbour.sort_order, me.id)
    db.prepare(`UPDATE accounts SET sort_order = ? WHERE id = ?`).run(me.sort_order, neighbour.id)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  return true
}

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
