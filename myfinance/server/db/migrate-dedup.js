/**
 * One-time migration: recompute dedup_key for all existing transactions using the
 * new content-hash scheme (see save-transactions.js). Run after changing the dedup
 * logic so that future re-imports match existing rows instead of duplicating them.
 *
 * Also resets last_scraped for FIBI accounts, whose earlier import lost recurring
 * transactions (FIBI reuses the bank "reference" per payee) — so the next sync
 * re-fetches the full history correctly.
 *
 * Run with:  node server/db/migrate-dedup.js
 */

import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { computeContentHash } from './save-transactions.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.join(__dirname, '..', '..', 'data', 'myfinance.db')

const db = new DatabaseSync(DB_PATH)

const rows = db.prepare(`
  SELECT id, source, account_number, date, amount, description, original_currency
  FROM transactions
  ORDER BY source, account_number, date, id
`).all()

console.log(`Migrating ${rows.length} transactions to content-hash dedup keys...`)

db.exec('BEGIN')
try {
  // Pass 1: set a temporary unique key to avoid UNIQUE collisions mid-migration
  const tmpStmt = db.prepare(`UPDATE transactions SET dedup_key = ? WHERE id = ?`)
  for (const r of rows) {
    tmpStmt.run(`__migrating_${r.id}`, r.id)
  }

  // Pass 2: assign final content-hash keys with per-hash occurrence index
  const occurrence = new Map()
  const finalStmt = db.prepare(`UPDATE transactions SET dedup_key = ? WHERE id = ?`)
  for (const r of rows) {
    const baseHash = computeContentHash(
      r.source, r.account_number, r.date, r.amount, r.description, r.original_currency,
    )
    const occ = occurrence.get(baseHash) || 0
    occurrence.set(baseHash, occ + 1)
    finalStmt.run(`${baseHash}:${occ}`, r.id)
  }

  // Force FIBI accounts to re-fetch full history (their data was incomplete)
  const reset = db.prepare(`UPDATE accounts SET last_scraped = NULL WHERE source = 'fibi'`).run()
  console.log(`Reset last_scraped for ${reset.changes} FIBI account(s).`)

  db.exec('COMMIT')
  console.log('Migration complete.')
} catch (err) {
  db.exec('ROLLBACK')
  console.error('Migration failed, rolled back:', err.message)
  process.exit(1)
}

db.close()
