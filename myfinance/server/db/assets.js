/**
 * Financial assets — holdings at pension funds, insurance companies and
 * investment houses. Entered manually and updated about once a month. Each asset
 * has a history of snapshots (balance + deposits as of a date); the summary uses
 * the most recent snapshot per asset.
 */

import { getDb } from './database.js'

/** List all assets (by manual sort order) with their latest snapshot folded in. */
export function listAssets(db = getDb(), { includeArchived = false } = {}) {
  const where = includeArchived ? '' : 'WHERE a.archived = 0'
  return db.prepare(`
    SELECT a.id, a.kind, a.category, a.institution, a.asset_type, a.label,
           a.owner, a.currency, a.note, a.archived, a.sort_order, a.created_at,
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
    ORDER BY a.archived ASC, a.sort_order ASC, a.id ASC
  `).all()
}

/** Create a new asset (or liability). Returns the new row's id. */
export function createAsset(db, { kind = 'asset', category = '', institution, asset_type, label = '', owner = 'Me', currency = 'ILS', note = '' }) {
  // New rows go to the bottom of the list — one past the current max sort_order.
  const nextOrder = (db.prepare(`SELECT MAX(sort_order) AS m FROM financial_assets`).get().m || 0) + 1
  const info = db.prepare(`
    INSERT INTO financial_assets (kind, category, institution, asset_type, label, owner, currency, note, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(kind === 'liability' ? 'liability' : 'asset', category, institution, asset_type, label, owner, currency, note, nextOrder)
  return Number(info.lastInsertRowid)
}

/** Update an asset's editable fields. */
export function updateAsset(db, id, { kind, category, institution, asset_type, label, owner, currency, note, archived }) {
  db.prepare(`
    UPDATE financial_assets
    SET kind = ?, category = ?, institution = ?, asset_type = ?, label = ?, owner = ?,
        currency = ?, note = ?, archived = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(kind === 'liability' ? 'liability' : 'asset', category ?? '', institution, asset_type,
         label ?? '', owner, currency ?? 'ILS', note ?? '', archived ? 1 : 0, id)
}

/**
 * Move an asset one step up or down within its own kind (assets and liabilities
 * are ordered separately) by swapping sort_order with the adjacent same-kind
 * neighbour. Returns true if a swap happened, false if already at the edge.
 */
export function moveAsset(db, id, direction) {
  const me = db.prepare(`SELECT id, kind, sort_order FROM financial_assets WHERE id = ?`).get(id)
  if (!me) return false
  // 'up' = higher in the list = smaller sort_order. Tie-break on id so equal
  // sort_orders still move. Only swap within the same kind.
  const neighbour = direction === 'up'
    ? db.prepare(`SELECT id, sort_order FROM financial_assets
                  WHERE kind = ? AND (sort_order < ? OR (sort_order = ? AND id < ?))
                  ORDER BY sort_order DESC, id DESC LIMIT 1`).get(me.kind, me.sort_order, me.sort_order, me.id)
    : db.prepare(`SELECT id, sort_order FROM financial_assets
                  WHERE kind = ? AND (sort_order > ? OR (sort_order = ? AND id > ?))
                  ORDER BY sort_order ASC, id ASC LIMIT 1`).get(me.kind, me.sort_order, me.sort_order, me.id)
  if (!neighbour) return false

  db.exec('BEGIN')
  try {
    db.prepare(`UPDATE financial_assets SET sort_order = ? WHERE id = ?`).run(neighbour.sort_order, me.id)
    db.prepare(`UPDATE financial_assets SET sort_order = ? WHERE id = ?`).run(me.sort_order, neighbour.id)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  return true
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
 * Summary across all active rows, using each row's latest snapshot.
 *   gross = sum of asset balances (ILS); liabilities = sum of liability balances;
 *   net   = gross − liabilities.
 * Only ILS rows are summed into the totals (mixed currencies are still listed
 * per-row; a multi-currency total would be misleading). Also returns breakdowns
 * by category, institution, asset_type and owner — over assets only.
 */
export function assetsSummary(db = getDb()) {
  const rows = listAssets(db, { includeArchived: false })
  const withBalance = rows.filter(a => a.last_balance != null && a.currency === 'ILS')
  const assets      = withBalance.filter(a => a.kind !== 'liability')
  const liabilities = withBalance.filter(a => a.kind === 'liability')

  const sumBy = (list, keyFn) => {
    const map = new Map()
    for (const a of list) {
      const k = keyFn(a) || '—'
      map.set(k, (map.get(k) || 0) + a.last_balance)
    }
    return [...map.entries()]
      .map(([key, total]) => ({ key, total }))
      .sort((x, y) => y.total - x.total)
  }

  const sumOf = (list, pick = a => a.last_balance) => list.reduce((s, a) => s + (pick(a) || 0), 0)

  const gross = sumOf(assets)
  const totalLiabilities = sumOf(liabilities)

  return {
    total: gross,                 // kept for backward compatibility (gross assets)
    gross,
    totalLiabilities,
    net: gross - totalLiabilities,
    totalDeposits: sumOf(assets, a => a.last_deposits),
    count: rows.length,
    assetCount: rows.filter(a => a.kind !== 'liability').length,
    liabilityCount: rows.filter(a => a.kind === 'liability').length,
    byCategory:    sumBy(assets, a => a.category),
    byInstitution: sumBy(assets, a => a.institution),
    byType:        sumBy(assets, a => a.asset_type),
    byOwner:       sumBy(assets, a => a.owner),
  }
}
