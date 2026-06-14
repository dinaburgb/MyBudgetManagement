/**
 * Database connection and helper functions.
 * Uses Node.js built-in node:sqlite — no external packages needed.
 */

import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SCHEMA_SQL } from './schema.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR  = path.join(__dirname, '..', '..', 'data')
const DB_PATH   = path.join(DATA_DIR, 'myfinance.db')
const BACKUP_DIR = path.join(DATA_DIR, 'backups')

let _db = null

/** Open (or create) the database and run the schema migrations. */
export function openDatabase() {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.mkdirSync(BACKUP_DIR, { recursive: true })
  _db = new DatabaseSync(DB_PATH)
  _db.exec(SCHEMA_SQL)
  runSchemaMigrations(_db)
  console.log(`Database ready: ${DB_PATH}`)
  return _db
}

/**
 * Idempotent schema migrations for databases created before a column existed.
 * CREATE TABLE IF NOT EXISTS never alters an existing table, so new columns are
 * added here with ALTER TABLE, guarded by a PRAGMA check so they run only once.
 */
function runSchemaMigrations(db) {
  const hasColumn = (table, col) =>
    db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col)

  if (!hasColumn('accounts', 'include_in_totals')) {
    db.exec(`ALTER TABLE accounts ADD COLUMN include_in_totals INTEGER NOT NULL DEFAULT 1`)
    console.log('Migration: added accounts.include_in_totals')
  }

  if (!hasColumn('transactions', 'note')) {
    db.exec(`ALTER TABLE transactions ADD COLUMN note TEXT DEFAULT ''`)
    console.log('Migration: added transactions.note')
  }

  if (!hasColumn('categories', 'is_income')) {
    db.exec(`ALTER TABLE categories ADD COLUMN is_income INTEGER NOT NULL DEFAULT 0`)
    // Mark an existing user-created 'הכנסות' category as income (one-time, on add).
    db.exec(`UPDATE categories SET is_income = 1 WHERE name = 'הכנסות'`)
    console.log('Migration: added categories.is_income')
  }

  if (!hasColumn('transactions', 'is_transfer')) {
    db.exec(`ALTER TABLE transactions ADD COLUMN is_transfer INTEGER NOT NULL DEFAULT 0`)
    console.log('Migration: added transactions.is_transfer')
  }

  if (!hasColumn('accounts', 'sort_order')) {
    db.exec(`ALTER TABLE accounts ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0`)
    // Give existing accounts a stable initial order (by id) so the up/down
    // controls have something deterministic to rearrange.
    db.exec(`UPDATE accounts SET sort_order = id`)
    console.log('Migration: added accounts.sort_order')
  }

  if (!hasColumn('categories', 'is_excluded')) {
    db.exec(`ALTER TABLE categories ADD COLUMN is_excluded INTEGER NOT NULL DEFAULT 0`)
    // A credit-card repayment debit is not a real expense (the card's own charges
    // are already itemized) — exclude it from all totals by default.
    db.exec(`UPDATE categories SET is_excluded = 1 WHERE name = 'הורדת כרטיס אשראי'`)
    console.log('Migration: added categories.is_excluded')
  }

  if (!hasColumn('financial_assets', 'kind')) {
    db.exec(`ALTER TABLE financial_assets ADD COLUMN kind TEXT NOT NULL DEFAULT 'asset'`)
    console.log('Migration: added financial_assets.kind')
  }

  if (!hasColumn('financial_assets', 'category')) {
    db.exec(`ALTER TABLE financial_assets ADD COLUMN category TEXT DEFAULT ''`)
    console.log('Migration: added financial_assets.category')
  }

  if (!hasColumn('financial_assets', 'sort_order')) {
    db.exec(`ALTER TABLE financial_assets ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0`)
    // Give existing assets a stable initial order (by id) so the up/down controls
    // have something deterministic to rearrange.
    db.exec(`UPDATE financial_assets SET sort_order = id`)
    console.log('Migration: added financial_assets.sort_order')
  }
}

/** Get the active database connection. Throws if not yet opened. */
export function getDb() {
  if (!_db) throw new Error('Database not opened — call openDatabase() first')
  return _db
}

/** Close the database connection cleanly (used on graceful shutdown). */
export function closeDatabase() {
  if (_db) {
    try { _db.close() } catch { /* already closed */ }
    _db = null
  }
}

/**
 * Create a backup of the database file before an import.
 * Keeps the last 7 backups — older ones are deleted automatically.
 */
export function backupDatabase() {
  if (!fs.existsSync(DB_PATH)) return  // nothing to back up yet
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dest = path.join(BACKUP_DIR, `myfinance_${timestamp}.db`)
  fs.copyFileSync(DB_PATH, dest)
  console.log(`Backup created: ${dest}`)

  // Keep only the 7 most recent backups
  const backups = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith('.db'))
    .map(f => ({ name: f, mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtime }))
    .sort((a, b) => b.mtime - a.mtime)

  for (const old of backups.slice(7)) {
    fs.unlinkSync(path.join(BACKUP_DIR, old.name))
  }
}

/** Write one line to the activity log (no sensitive data). */
export function logActivity(event, source = null, details = null) {
  const db = getDb()
  db.prepare(
    `INSERT INTO activity_log (event, source, details) VALUES (?, ?, ?)`
  ).run(event, source, details)
}
