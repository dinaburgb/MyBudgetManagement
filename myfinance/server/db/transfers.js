/**
 * Internal-transfer detection. A transfer between the user's own accounts shows
 * up as two transactions: a negative leg on account A and a positive leg of the
 * same magnitude on account B, a few days apart. Counting both inflates income
 * and expenses, so the user can mark such pairs — both legs get `is_transfer = 1`
 * and are then ignored in every total. We only SUGGEST pairs; nothing is removed
 * without the user confirming.
 */

import { getDb } from './database.js'

const DEFAULT_WINDOW_DAYS = 5

/**
 * Suggest likely transfer pairs: opposite sign, equal magnitude, different
 * (included) accounts, within `windowDays`, neither already a transfer, and not
 * previously dismissed. Each transaction appears in at most one suggested pair
 * (greedy nearest-date matching). Returns an array of pair objects.
 */
export function findTransferCandidates(db = getDb(), { windowDays = DEFAULT_WINDOW_DAYS } = {}) {
  // a = the negative (outgoing) leg, b = the positive (incoming) leg. Requiring
  // a.amount < 0 makes each pair appear once, not twice.
  const rows = db.prepare(`
    SELECT a.id AS a_id, b.id AS b_id,
           a.amount AS amount,
           a.date AS a_date, b.date AS b_date,
           a.account_id AS a_account_id, b.account_id AS b_account_id,
           a.account_name AS a_account, b.account_name AS b_account,
           a.description AS a_desc, b.description AS b_desc,
           ABS(julianday(b.date) - julianday(a.date)) AS day_gap
    FROM transactions a
    JOIN transactions b
      ON b.amount = -a.amount
     AND a.account_id <> b.account_id
     AND ABS(julianday(b.date) - julianday(a.date)) <= ?
    JOIN accounts aa ON aa.id = a.account_id AND aa.include_in_totals = 1
    JOIN accounts ab ON ab.id = b.account_id AND ab.include_in_totals = 1
    WHERE a.amount < 0
      AND a.is_transfer = 0 AND b.is_transfer = 0
      AND NOT EXISTS (
        SELECT 1 FROM ignored_transfer_pairs p
        WHERE p.low_id  = MIN(a.id, b.id)
          AND p.high_id = MAX(a.id, b.id)
      )
    ORDER BY day_gap ASC, ABS(a.amount) DESC
  `).all(windowDays)

  // Greedy dedupe: each transaction id used at most once.
  const used = new Set()
  const pairs = []
  for (const r of rows) {
    if (used.has(r.a_id) || used.has(r.b_id)) continue
    used.add(r.a_id); used.add(r.b_id)
    pairs.push(r)
  }
  return pairs
}

/** How many transfer pairs are currently suggested (for a badge). */
export function countTransferCandidates(db = getDb()) {
  return findTransferCandidates(db).length
}

/** Mark both legs of a pair as an internal transfer. */
export function markTransferPair(db, aId, bId) {
  const stmt = db.prepare(`UPDATE transactions SET is_transfer = 1, updated_at = datetime('now') WHERE id = ?`)
  db.exec('BEGIN')
  try { stmt.run(aId); stmt.run(bId); db.exec('COMMIT') }
  catch (err) { db.exec('ROLLBACK'); throw err }
}

/** Clear the transfer flag on a single transaction. */
export function unmarkTransfer(db, id) {
  db.prepare(`UPDATE transactions SET is_transfer = 0, updated_at = datetime('now') WHERE id = ?`).run(id)
}

/** Remember that a suggested pair is NOT a transfer, so it won't be suggested again. */
export function ignoreTransferPair(db, aId, bId) {
  const low = Math.min(aId, bId), high = Math.max(aId, bId)
  db.prepare(`INSERT OR IGNORE INTO ignored_transfer_pairs (low_id, high_id) VALUES (?, ?)`).run(low, high)
}
