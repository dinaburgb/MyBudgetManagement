/**
 * Tests for financial assets (manual pension/insurance/investment holdings).
 * In-memory DB. Run with:  node tests/test_assets.js
 */

import { DatabaseSync } from 'node:sqlite'
import assert from 'node:assert'
import { SCHEMA_SQL } from '../server/db/schema.js'
import {
  listAssets, createAsset, updateAsset, deleteAsset,
  upsertSnapshot, listSnapshots, deleteSnapshot, assetsSummary,
} from '../server/db/assets.js'

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

console.log('\nFinancial-asset tests:')

test('create + list returns the asset with no snapshot yet', () => {
  const db = freshDb()
  const id = createAsset(db, { institution: 'הראל', asset_type: 'קרן פנסיה', owner: 'Boris' })
  const rows = listAssets(db)
  assert.strictEqual(rows.length, 1)
  assert.strictEqual(rows[0].id, id)
  assert.strictEqual(rows[0].institution, 'הראל')
  assert.strictEqual(rows[0].last_balance, null)   // no snapshot
})

test('snapshot upsert overwrites the same date and keeps history', () => {
  const db = freshDb()
  const id = createAsset(db, { institution: 'מיטב', asset_type: 'קרן פנסיה' })
  upsertSnapshot(db, id, { snapshot_date: '2026-05-01', balance: 100000, deposits: 2000 })
  upsertSnapshot(db, id, { snapshot_date: '2026-06-01', balance: 105000, deposits: 2000 })
  upsertSnapshot(db, id, { snapshot_date: '2026-06-01', balance: 106000 })  // same date → replace
  const snaps = listSnapshots(db, id)
  assert.strictEqual(snaps.length, 2)
  assert.strictEqual(snaps[0].snapshot_date, '2026-06-01')   // newest first
  assert.strictEqual(snaps[0].balance, 106000)               // overwritten value
  assert.strictEqual(snaps[0].deposits, 0)                   // overwrite reset deposits
})

test('listAssets folds in the latest snapshot', () => {
  const db = freshDb()
  const id = createAsset(db, { institution: 'מור', asset_type: 'תיק השקעות' })
  upsertSnapshot(db, id, { snapshot_date: '2026-05-01', balance: 50000 })
  upsertSnapshot(db, id, { snapshot_date: '2026-06-01', balance: 55000, deposits: 1000 })
  const a = listAssets(db)[0]
  assert.strictEqual(a.last_date, '2026-06-01')
  assert.strictEqual(a.last_balance, 55000)
  assert.strictEqual(a.last_deposits, 1000)
})

test('summary totals ILS only and breaks down by type/owner', () => {
  const db = freshDb()
  const p = createAsset(db, { institution: 'הראל', asset_type: 'קרן פנסיה', owner: 'Boris' })
  const g = createAsset(db, { institution: 'מיטב', asset_type: 'קרן השתלמות', owner: 'Irena' })
  const ib = createAsset(db, { institution: 'אינטראקטיב ברוקרס', asset_type: 'תיק השקעות', owner: 'Joint', currency: 'USD' })
  upsertSnapshot(db, p, { snapshot_date: '2026-06-01', balance: 200000, deposits: 3000 })
  upsertSnapshot(db, g, { snapshot_date: '2026-06-01', balance: 80000, deposits: 1000 })
  upsertSnapshot(db, ib, { snapshot_date: '2026-06-01', balance: 10000 })  // USD — excluded from ILS total
  const s = assetsSummary(db)
  assert.strictEqual(s.total, 280000)        // USD holding not summed
  assert.strictEqual(s.totalDeposits, 4000)
  assert.strictEqual(s.count, 3)
  assert.strictEqual(s.byType.length, 2)     // only the two ILS types
  assert.strictEqual(s.byOwner.find(o => o.key === 'Boris').total, 200000)
})

test('archived assets are excluded from list and summary by default', () => {
  const db = freshDb()
  const id = createAsset(db, { institution: 'פסגות', asset_type: 'קופת גמל' })
  upsertSnapshot(db, id, { snapshot_date: '2026-06-01', balance: 40000 })
  updateAsset(db, id, { institution: 'פסגות', asset_type: 'קופת גמל', owner: 'Boris', currency: 'ILS', archived: 1 })
  assert.strictEqual(listAssets(db).length, 0)
  assert.strictEqual(listAssets(db, { includeArchived: true }).length, 1)
  assert.strictEqual(assetsSummary(db).total, 0)
})

test('deleting an asset cascades its snapshots', () => {
  const db = freshDb()
  const id = createAsset(db, { institution: 'אקסלנס', asset_type: 'גמל להשקעה' })
  upsertSnapshot(db, id, { snapshot_date: '2026-06-01', balance: 30000 })
  deleteAsset(db, id)
  assert.strictEqual(listAssets(db, { includeArchived: true }).length, 0)
  const snaps = db.prepare('SELECT COUNT(*) c FROM asset_snapshots').get().c
  assert.strictEqual(snaps, 0)
})

test('deleteSnapshot removes a single update', () => {
  const db = freshDb()
  const id = createAsset(db, { institution: 'כלל ביטוח', asset_type: 'פוליסת חיסכון' })
  upsertSnapshot(db, id, { snapshot_date: '2026-05-01', balance: 10000 })
  upsertSnapshot(db, id, { snapshot_date: '2026-06-01', balance: 12000 })
  const snaps = listSnapshots(db, id)
  deleteSnapshot(db, snaps[0].id)
  assert.strictEqual(listSnapshots(db, id).length, 1)
})

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
