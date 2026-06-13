/**
 * Tests for CSV formula-injection protection. Run: node tests/test_csv.js
 */
import assert from 'node:assert'
import { csvSafeText } from '../server/util/csv.js'

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS  ${name}`) }
  catch (e) { failed++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

console.log('\nCSV safety tests:')

test('plain text is just quoted', () => {
  assert.strictEqual(csvSafeText('שופרסל'), '"שופרסל"')
})

test('values starting with = + - @ are prefixed with a quote', () => {
  for (const ch of ['=', '+', '-', '@']) {
    assert.strictEqual(csvSafeText(`${ch}CMD()`), `"'${ch}CMD()"`)
  }
})

test('embedded quotes are doubled', () => {
  assert.strictEqual(csvSafeText('a "b" c'), '"a ""b"" c"')
})

test('null/undefined become empty', () => {
  assert.strictEqual(csvSafeText(null), '""')
  assert.strictEqual(csvSafeText(undefined), '""')
})

test('a leading tab/CR is also neutralised', () => {
  assert.strictEqual(csvSafeText('\t=1'), `"'\t=1"`)
})

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
