/**
 * Encryption module — AES-256-GCM with PBKDF2 key derivation.
 *
 * How it works:
 *   - The user's master password is NEVER saved anywhere.
 *   - A random 32-byte salt is generated once and saved to disk (not secret).
 *   - Every time the app starts the user enters their password, and we derive
 *     the encryption key from password + salt using PBKDF2 (100,000 rounds).
 *   - Data is encrypted with AES-256-GCM which also verifies integrity.
 *   - The key lives only in memory; it is cleared when the session ends.
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getDb } from '../db/database.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// Data dir is overridable via env so tests can point at a temp dir instead of the
// real data/ folder (which holds the user's actual salt + sentinel).
const DATA_DIR = process.env.MYFINANCE_CRYPTO_DIR || path.join(__dirname, '..', '..', 'data')
const SALT_FILE = path.join(DATA_DIR, 'salt.bin')
const SENTINEL_FILE = path.join(DATA_DIR, 'sentinel.enc')
const SENTINEL_VALUE = 'myfinance-ok'

const PBKDF2_ITERATIONS = 100_000
const PBKDF2_DIGEST = 'sha512'
const KEY_LEN = 32  // 256 bits for AES-256

// In-memory session key — never written to disk
let _sessionKey = null

/**
 * Load or create the salt file.
 * Salt is not secret — it just prevents dictionary attacks.
 */
function getOrCreateSalt() {
  if (fs.existsSync(SALT_FILE)) {
    return fs.readFileSync(SALT_FILE)
  }
  const salt = crypto.randomBytes(32)
  fs.mkdirSync(path.dirname(SALT_FILE), { recursive: true })
  fs.writeFileSync(SALT_FILE, salt)
  return salt
}

/**
 * Derive an AES-256 key from the master password.
 * Call this once when the user enters their password at startup.
 */
export function deriveKey(masterPassword) {
  const salt = getOrCreateSalt()
  _sessionKey = crypto.pbkdf2Sync(masterPassword, salt, PBKDF2_ITERATIONS, KEY_LEN, PBKDF2_DIGEST)
}

/** Returns true if the user has unlocked the app this session. */
export function isUnlocked() {
  return _sessionKey !== null
}

/** Clear the key from memory (on session end / logout). */
export function clearKey() {
  if (_sessionKey) {
    _sessionKey.fill(0)  // overwrite before releasing
    _sessionKey = null
  }
}

/**
 * Encrypt a string.
 * Returns a Base64 string: iv(12 bytes) + authTag(16 bytes) + ciphertext.
 */
export function encrypt(plaintext) {
  if (!_sessionKey) throw new Error('App is locked — enter master password first')
  const iv = crypto.randomBytes(12)  // AES-GCM standard IV size
  const cipher = crypto.createCipheriv('aes-256-gcm', _sessionKey, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()  // integrity check tag
  return Buffer.concat([iv, authTag, encrypted]).toString('base64')
}

/**
 * Decrypt a Base64 string produced by encrypt().
 * Throws if the data was tampered with (authTag mismatch).
 */
export function decrypt(ciphertext) {
  if (!_sessionKey) throw new Error('App is locked — enter master password first')
  const buf = Buffer.from(ciphertext, 'base64')
  const iv      = buf.subarray(0, 12)
  const authTag = buf.subarray(12, 28)
  const data    = buf.subarray(28)
  const decipher = crypto.createDecipheriv('aes-256-gcm', _sessionKey, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}

/**
 * Verify that a password is correct by trying to decrypt a known test value.
 * We store a small encrypted sentinel string and try to decrypt it.
 * Returns true if decryption succeeds (password is correct).
 */
export function savePasswordSentinel() {
  fs.writeFileSync(SENTINEL_FILE, encrypt(SENTINEL_VALUE))
}

export function verifyPassword(masterPassword) {
  if (!fs.existsSync(SENTINEL_FILE)) return null  // first run — no sentinel yet
  deriveKey(masterPassword)
  try {
    const value = decrypt(fs.readFileSync(SENTINEL_FILE, 'utf8'))
    if (value !== SENTINEL_VALUE) { clearKey(); return false }
    return true
  } catch {
    clearKey()
    return false
  }
}

/** True once a master password has been set (the sentinel exists). */
export function isPasswordSet() {
  return fs.existsSync(SENTINEL_FILE)
}

/**
 * Unlock the app, safely handling a missing sentinel (H5). Returns one of:
 *   'unlocked'  — sentinel present and the password matched
 *   'first_run' — no sentinel AND no stored credentials → genuine first setup
 *   'recovered' — no sentinel BUT stored credentials decrypt with this password
 *                 (the sentinel was lost) → it is safely recreated
 *   false       — wrong password (no encryption metadata is modified)
 *
 * The dangerous old behaviour — "no sentinel ⇒ treat any password as first run
 * and overwrite the sentinel" — would have orphaned existing encrypted
 * credentials. Here we never create a fresh sentinel while credentials exist
 * unless the entered password actually decrypts them.
 */
export function unlockOrInit(password, db = getDb()) {
  if (isPasswordSet()) {
    return verifyPassword(password) ? 'unlocked' : false
  }
  const row = db.prepare(`SELECT credentials FROM accounts WHERE credentials != '' LIMIT 1`).get()
  if (!row) {
    deriveKey(password)
    savePasswordSentinel()
    return 'first_run'
  }
  // Sentinel missing but credentials exist — verify by decrypting a real one.
  deriveKey(password)
  try {
    JSON.parse(decrypt(row.credentials))   // throws if the key (password) is wrong
    savePasswordSentinel()                 // re-create the lost sentinel
    return 'recovered'
  } catch {
    clearKey()
    return false
  }
}

/**
 * Change the master password. Verifies the old one, then re-encrypts every
 * stored bank/card credential under the key derived from the new password and
 * rewrites the sentinel. The session stays unlocked with the new key.
 * Throws { code: 'WRONG_PASSWORD' } if the old password is wrong.
 */
export function changeMasterPassword(oldPassword, newPassword) {
  const ok = verifyPassword(oldPassword)            // derives the OLD key on success
  if (ok !== true) throw Object.assign(new Error('wrong password'), { code: 'WRONG_PASSWORD' })

  const db = getDb()
  const accounts = db.prepare(`SELECT id, credentials FROM accounts`).all()
  // Decrypt everything with the old key while it's still active.
  const plain = accounts.map(a => ({ id: a.id, text: a.credentials ? decrypt(a.credentials) : '' }))

  deriveKey(newPassword)                            // switch session to the NEW key
  try {
    db.exec('BEGIN')
    const upd = db.prepare(`UPDATE accounts SET credentials = ?, updated_at = datetime('now') WHERE id = ?`)
    for (const p of plain) upd.run(p.text ? encrypt(p.text) : '', p.id)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    deriveKey(oldPassword)                          // restore a working session
    throw err
  }
  savePasswordSentinel()                            // sentinel now under the new key
  return { reencrypted: plain.length }
}

/**
 * Reset the master password ("forgot password"). The encryption key can't be
 * recovered, so this wipes the salt + sentinel and clears the (now-unusable)
 * encrypted credentials — but keeps ALL financial data (transactions, categories,
 * budgets are stored in plaintext). The user then sets a fresh password and
 * re-enters each bank/card login. Returns how many accounts were cleared.
 */
export function resetMasterPassword() {
  const db = getDb()
  const cleared = db.prepare(`SELECT COUNT(*) c FROM accounts WHERE credentials != ''`).get().c
  db.prepare(`UPDATE accounts SET credentials = '', updated_at = datetime('now')`).run()
  clearKey()
  for (const f of [SALT_FILE, SENTINEL_FILE]) {
    try { if (fs.existsSync(f)) fs.unlinkSync(f) } catch { /* best effort */ }
  }
  return { clearedAccounts: cleared }
}
