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

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SALT_FILE = path.join(__dirname, '..', '..', 'data', 'salt.bin')

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
const SENTINEL_FILE = path.join(__dirname, '..', '..', 'data', 'sentinel.enc')
const SENTINEL_VALUE = 'myfinance-ok'

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
