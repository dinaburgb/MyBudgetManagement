/**
 * Tests for safe unlock / sentinel recovery (H5). Uses a TEMP crypto dir via
 * MYFINANCE_CRYPTO_DIR so the real data/salt.bin and data/sentinel.enc are never
 * touched. Run: node tests/test_auth.js
 */
import { DatabaseSync } from 'node:sqlite'
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { SCHEMA_SQL } from '../server/db/schema.js'

// Point the crypto module at a throwaway dir BEFORE importing it.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mbm-auth-'))
process.env.MYFINANCE_CRYPTO_DIR = TMP
const { unlockOrInit, encrypt, clearKey, isPasswordSet } = await import('../server/crypto/encryption.js')

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS  ${name}`) }
  catch (e) { failed++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

function freshDb() {
  const db = new DatabaseSync(':memory:')
  db.exec(SCHEMA_SQL)
  return db
}
const sentinelPath = path.join(TMP, 'sentinel.enc')
const PW = 'correct-horse-123'

// Wipe crypto state so each scenario starts clean (no leftover salt/sentinel).
function resetFiles() {
  for (const f of ['salt.bin', 'sentinel.enc']) {
    try { fs.unlinkSync(path.join(TMP, f)) } catch { /* not there */ }
  }
  clearKey()
}

console.log('\nAuth / sentinel-recovery tests:')

test('first run on an empty DB initialises the password', () => {
  resetFiles()
  const db = freshDb()
  assert.strictEqual(unlockOrInit(PW, db), 'first_run')
  assert.ok(isPasswordSet())
})

test('lost sentinel + wrong password does NOT re-init (H5 guard)', () => {
  resetFiles()
  const db = freshDb()
  assert.strictEqual(unlockOrInit(PW, db), 'first_run')   // sets key + sentinel
  // Add an account whose credentials are encrypted under the correct key.
  const cred = encrypt(JSON.stringify({ user: 'x', password: 'y' }))
  db.prepare(`INSERT INTO accounts (name,source,owner,credentials) VALUES (?,?,?,?)`)
    .run('A', 'discount', 'Boris', cred)
  // Simulate a lost sentinel.
  fs.unlinkSync(sentinelPath); clearKey()
  assert.ok(!isPasswordSet())

  // Wrong password must be rejected and must NOT recreate the sentinel.
  assert.strictEqual(unlockOrInit('totally-wrong', db), false)
  assert.ok(!isPasswordSet(), 'sentinel must not be recreated on a wrong password')
})

test('lost sentinel + correct password recovers and recreates the sentinel', () => {
  resetFiles()
  const db = freshDb()
  assert.strictEqual(unlockOrInit(PW, db), 'first_run')
  const cred = encrypt(JSON.stringify({ user: 'x' }))
  db.prepare(`INSERT INTO accounts (name,source,owner,credentials) VALUES (?,?,?,?)`)
    .run('A', 'discount', 'Boris', cred)
  fs.unlinkSync(sentinelPath); clearKey()

  assert.strictEqual(unlockOrInit(PW, db), 'recovered')
  assert.ok(isPasswordSet())
  // And a normal unlock works afterwards.
  clearKey()
  assert.strictEqual(unlockOrInit(PW, db), 'unlocked')
  assert.strictEqual(unlockOrInit('nope', db), false)
})

// Cleanup
try { fs.rmSync(TMP, { recursive: true, force: true }) } catch { /* ignore */ }

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
