/**
 * Tests for the encryption module — AES-256-GCM round trip with FAKE data only.
 * No real credentials, no bank access.
 *
 * Run with:  node tests/test_encryption.js
 *
 * Note: deriveKey() reads (or creates) data/salt.bin. It never touches stored
 * credentials or the password sentinel, so this test is safe to run locally.
 */

import assert from 'node:assert'
import { deriveKey, encrypt, decrypt, isUnlocked, clearKey } from '../server/crypto/encryption.js'

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS  ${name}`) }
  catch (e) { failed++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

console.log('\nEncryption tests (fake data only):')

test('locked by default: encrypt throws before deriveKey', () => {
  clearKey()
  assert.strictEqual(isUnlocked(), false)
  assert.throws(() => encrypt('x'), /locked/i)
})

test('round trip: decrypt(encrypt(x)) === x', () => {
  deriveKey('fake-master-password-123')
  assert.strictEqual(isUnlocked(), true)
  const secret = JSON.stringify({ userCode: 'FAKE-USER', password: 'FAKE-PASS' })
  const cipher = encrypt(secret)
  assert.notStrictEqual(cipher, secret)        // actually encrypted
  assert.strictEqual(decrypt(cipher), secret)  // and reversible
})

test('each encryption uses a fresh IV (ciphertext differs)', () => {
  deriveKey('fake-master-password-123')
  const a = encrypt('same plaintext')
  const b = encrypt('same plaintext')
  assert.notStrictEqual(a, b)  // random IV per call
  assert.strictEqual(decrypt(a), 'same plaintext')
  assert.strictEqual(decrypt(b), 'same plaintext')
})

test('tampered ciphertext fails the auth tag (cannot decrypt)', () => {
  deriveKey('fake-master-password-123')
  const cipher = encrypt('important')
  const buf = Buffer.from(cipher, 'base64')
  buf[buf.length - 1] ^= 0xff             // flip the last byte of the ciphertext
  const tampered = buf.toString('base64')
  assert.throws(() => decrypt(tampered))  // GCM auth tag rejects it
})

test('wrong password cannot decrypt data from another password', () => {
  deriveKey('password-A')
  const cipher = encrypt('top secret')
  clearKey()
  deriveKey('password-B')                 // different password -> different key
  assert.throws(() => decrypt(cipher))    // cannot read it
})

test('clearKey locks the module again', () => {
  deriveKey('fake-master-password-123')
  clearKey()
  assert.strictEqual(isUnlocked(), false)
  assert.throws(() => encrypt('x'), /locked/i)
})

clearKey()
console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
