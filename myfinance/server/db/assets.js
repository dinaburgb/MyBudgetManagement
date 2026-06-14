/**
 * Financial assets — holdings at pension funds, insurance companies and
 * investment houses. Entered manually and updated about once a month. Each asset
 * has a history of snapshots (balance + deposits as of a date); the summary uses
 * the most recent snapshot per asset.
 */

import { getDb } from './database.js'

/** List all assets (newest first) with their latest snapshot folded in. */
export function listAssets(db = getDb(), { includeArchived = false } = {}) {
  const where = includeArchived ? '' : 'WHERE a.archived = 0'
  return db.prepare(`
    SELECT a.id, a.institution, a.asset_type, a.label, a.owner, a.currency,
           a.note, a.archived, a.created_at,
           s.snapshot_date AS last_date,
           s.balance       AS last_balance,
           s.deposits      AS last_deposits
    FROM financial_assets a
    LEFT JOIN asset_snapshots s
      ON s.id = (
        SELECT id FROM asset_snapshots
        WHERE asset_id = a.id
        ORDER BY snapshot_date DESC, id DESC
        LIMIT 1
      )
    ${where}
    ORDER BY a.archived ASC, a.institution ASC, a.id ASC
  `).all()
}

/** Create a new asset. Returns the new row's id. */
export function createAsset(db, { institution, asset_type, label = '', owner = 'Boris', currency = 'ILS', note = '' }) {
  const info = db.prepare(`
    INSERT INTO financial_assets (institution, asset_type, label, owner, currency, note)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(institution, asset_type, label, owner, currency, note)
  return Number(info.lastInsertRowid)
}

/** Update an asset's editable fields. */
export function updateAsset(db, id, { institution, asset_type, label, owner, currency, note, archived }) {
  db.prepare(`
    UPDATE financial_assets
    SET institution = ?, asset_type = ?, label = ?, owner = ?, currency = ?,
        note = ?, archived = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(institution, asset_type, label ?? '', owner, currency ?? 'ILS', note ?? '',
         archived ? 1 : 0, id)
}

/** Delete an asset and all its snapshots. (Explicit, so it doesn't rely on the
 *  PRAGMA foreign_keys cascade being on.) */
export function deleteAsset(db, id) {
  db.prepare(`DELETE FROM asset_snapshots WHERE asset_id = ?`).run(id)
  db.prepare(`DELETE FROM financial_assets WHERE id = ?`).run(id)
}

/**
 * Insert or update a snapshot for an asset on a given date. One row per
 * (asset_id, snapshot_date) — re-saving the same date overwrites it.
 */
export function upsertSnapshot(db, assetId, { snapshot_date, balance, deposits = 0, note = '' }) {
  db.prepare(`
    INSERT INTO asset_snapshots (asset_id, snapshot_date, balance, deposits, note)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(asset_id, snapshot_date)
    DO UPDATE SET balance = excluded.balance,
                  deposits = excluded.deposits,
                  note = excluded.note
  `).run(assetId, snapshot_date, Number(balance), Number(deposits) || 0, note)
}

/** All snapshots for an asset, newest first. */
export function listSnapshots(db, assetId) {
  return db.prepare(`
    SELECT id, asset_id, snapshot_date, balance, deposits, note, created_at
    FROM asset_snapshots
    WHERE asset_id = ?
    ORDER BY snapshot_date DESC, id DESC
  `).all(assetId)
}

/** Delete a single snapshot. */
export function deleteSnapshot(db, snapshotId) {
  db.prepare(`DELETE FROM asset_snapshots WHERE id = ?`).run(snapshotId)
}

/**
 * Summary across all active assets, using each asset's latest snapshot.
 * Returns totals overall, plus breakdowns by institution, by asset_type and by
 * owner. Only ILS holdings are summed into the grand total (mixed currencies are
 * still listed per-asset; a multi-currency total would be misleading).
 */
export function assetsSummary(db = getDb()) {
  const assets = listAssets(db, { includeArchived: false })
  const withBalance = assets.filter(a => a.last_balance != null)

  const sumBy = (keyFn) => {
    const map = new Map()
    for (const a of withBalance) {
      if (a.currency !== 'ILS') continue
      const k = keyFn(a)
      map.set(k, (map.get(k) || 0) + a.last_balance)
    }
    return [...map.entries()]
      .map(([key, total]) => ({ key, total }))
      .sort((x, y) => y.total - x.total)
  }

  const total = withBalance
    .filter(a => a.currency === 'ILS')
    .reduce((s, a) => s + a.last_balance, 0)
  const totalDeposits = withBalance
    .filter(a => a.currency === 'ILS')
    .reduce((s, a) => s + (a.last_deposits || 0), 0)

  return {
    total,
    totalDeposits,
    count: assets.length,
    byInstitution: sumBy(a => a.institution),
    byType:        sumBy(a => a.asset_type),
    byOwner:       sumBy(a => a.owner),
  }
}
