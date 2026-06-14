/**
 * Financial assets API — manually-tracked holdings at pension/insurance/
 * investment providers, updated about once a month.
 *
 *   GET    /api/assets                      list assets (+ latest snapshot)
 *   GET    /api/assets/summary              totals + breakdowns
 *   POST   /api/assets                      create an asset
 *   PUT    /api/assets/:id                  update an asset
 *   DELETE /api/assets/:id                  delete an asset (+ its snapshots)
 *   GET    /api/assets/:id/snapshots        history for one asset
 *   POST   /api/assets/:id/snapshots        add/update a snapshot for a date
 *   DELETE /api/assets/snapshots/:sid       delete one snapshot
 */

import { Router } from 'express'
import { getDb } from '../db/database.js'
import { isUnlocked } from '../crypto/encryption.js'
import {
  listAssets, createAsset, updateAsset, deleteAsset,
  upsertSnapshot, listSnapshots, deleteSnapshot, assetsSummary,
} from '../db/assets.js'

const router = Router()

router.use((req, res, next) => {
  if (!isUnlocked()) return res.status(401).json({ error: 'App is locked' })
  next()
})

const isValidDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

/** GET /api/assets — all assets with their latest snapshot. */
router.get('/', (req, res) => {
  const includeArchived = req.query.includeArchived === '1'
  res.json({ assets: listAssets(getDb(), { includeArchived }) })
})

/** GET /api/assets/summary — totals and breakdowns. */
router.get('/summary', (req, res) => {
  res.json(assetsSummary(getDb()))
})

/** POST /api/assets — create an asset. */
router.post('/', (req, res) => {
  const { institution, asset_type, label, owner, currency, note } = req.body || {}
  if (!institution || !asset_type) {
    return res.status(400).json({ error: 'institution and asset_type are required' })
  }
  const id = createAsset(getDb(), { institution, asset_type, label, owner, currency, note })
  res.json({ id, message: 'Asset created' })
})

/** PUT /api/assets/:id — update an asset. */
router.put('/:id', (req, res) => {
  const id = Number(req.params.id)
  const { institution, asset_type, label, owner, currency, note, archived } = req.body || {}
  if (!institution || !asset_type) {
    return res.status(400).json({ error: 'institution and asset_type are required' })
  }
  updateAsset(getDb(), id, { institution, asset_type, label, owner, currency, note, archived })
  res.json({ message: 'Asset updated' })
})

/** DELETE /api/assets/:id — delete an asset and its snapshots. */
router.delete('/:id', (req, res) => {
  deleteAsset(getDb(), Number(req.params.id))
  res.json({ message: 'Asset deleted' })
})

/** GET /api/assets/:id/snapshots — history for one asset. */
router.get('/:id/snapshots', (req, res) => {
  res.json({ snapshots: listSnapshots(getDb(), Number(req.params.id)) })
})

/** POST /api/assets/:id/snapshots — add or update a snapshot for a date. */
router.post('/:id/snapshots', (req, res) => {
  const id = Number(req.params.id)
  const { snapshot_date, balance, deposits, note } = req.body || {}
  if (!isValidDate(snapshot_date)) {
    return res.status(400).json({ error: 'snapshot_date must be YYYY-MM-DD' })
  }
  const bal = Number(balance)
  if (balance == null || !Number.isFinite(bal)) {
    return res.status(400).json({ error: 'balance must be a number' })
  }
  const dep = deposits == null || deposits === '' ? 0 : Number(deposits)
  if (!Number.isFinite(dep)) {
    return res.status(400).json({ error: 'deposits must be a number' })
  }
  upsertSnapshot(getDb(), id, { snapshot_date, balance: bal, deposits: dep, note })
  res.json({ message: 'Snapshot saved' })
})

/** DELETE /api/assets/snapshots/:sid — delete one snapshot. */
router.delete('/snapshots/:sid', (req, res) => {
  deleteSnapshot(getDb(), Number(req.params.sid))
  res.json({ message: 'Snapshot deleted' })
})

export default router
