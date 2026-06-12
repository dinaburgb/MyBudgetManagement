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
  console.log(`Database ready: ${DB_PATH}`)
  return _db
}

/** Get the active database connection. Throws if not yet opened. */
export function getDb() {
  if (!_db) throw new Error('Database not opened — call openDatabase() first')
  return _db
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
