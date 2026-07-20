/**
 * Transactions API — read and filter transactions.
 */

import { Router } from 'express'
import { getDb } from '../db/database.js'
import { isUnlocked } from '../crypto/encryption.js'
import { notExcludedSql } from '../db/subaccounts.js'
import { insertManualTransaction } from '../db/save-transactions.js'
import { bulkSetCategory } from '../db/categorize.js'
import { csvSafeText } from '../util/csv.js'

const router = Router()

router.use((req, res, next) => {
  if (!isUnlocked()) return res.status(401).json({ error: 'App is locked' })
  next()
})

/**
 * Build the WHERE clause + params from a filter object (the same keys the GET
 * endpoint accepts as query params). Shared by the list endpoint and the bulk
 * category update, so "apply to all filtered transactions" matches exactly what
 * the user sees on screen.
 */
function buildTxnFilters(query) {
  const {
    owner, source, category, status,
    account_id, exclude_account_id,
    only_in_totals, foreign_currency,
    date_from, date_to,
    amount_min, amount_max,
    search,
  } = query

  const where  = []
  const params = []

  // A filter may be a single value or a comma-separated list (multi-select).
  // For lists we build an IN (?, ?, ...) clause.
  const addIn = (col, raw, map = v => v) => {
    const vals = String(raw).split(',').map(s => s.trim()).filter(Boolean).map(map)
    if (vals.length === 0) return
    where.push(`${col} IN (${vals.map(() => '?').join(',')})`)
    params.push(...vals)
  }

  if (owner)      addIn('owner', owner)
  if (source)     addIn('source', source)
  if (category)   addIn('category', category)
  if (status)     { where.push('status = ?');     params.push(status) }
  if (account_id) addIn('account_id', account_id, Number)
  if (exclude_account_id) { where.push('account_id != ?'); params.push(Number(exclude_account_id)) }
  // Sub-account filter: comma-separated "accountId:accountNumber" pairs. Matched
  // as (account_id = ? AND account_number = ?) so a number can't collide across
  // two different logins that happen to share it.
  if (query.subaccount) {
    const ors = []
    for (const pair of String(query.subaccount).split(',').map(s => s.trim()).filter(Boolean)) {
      const sep = pair.indexOf(':')
      if (sep === -1) continue
      const accId = Number(pair.slice(0, sep))
      const number = pair.slice(sep + 1)
      if (!Number.isInteger(accId) || accId <= 0 || !number) continue
      ors.push('(account_id = ? AND account_number = ?)')
      params.push(accId, number)
    }
    if (ors.length) where.push(`(${ors.join(' OR ')})`)
  }
  // Only transactions from accounts the user includes in totals
  if (only_in_totals === '1') {
    where.push('account_id IN (SELECT id FROM accounts WHERE include_in_totals = 1)')
    where.push(notExcludedSql('transactions.account_id', 'transactions.account_number'))
  }
  // Foreign-currency transactions only — the strongest signal for charges made
  // abroad (e.g. when reviewing a trip's expenses).
  if (foreign_currency === '1') {
    where.push("(COALESCE(original_currency, 'ILS') != 'ILS' OR COALESCE(charged_currency, 'ILS') != 'ILS')")
  }
  if (date_from)  { where.push('date >= ?');      params.push(date_from) }
  if (date_to)    { where.push('date <= ?');      params.push(date_to) }
  if (amount_min) { where.push('amount >= ?');    params.push(Number(amount_min)) }
  if (amount_max) { where.push('amount <= ?');    params.push(Number(amount_max)) }
  // Search matches the START of the description (prefix). Escape LIKE wildcards in
  // the user's input so % and _ are treated literally.
  if (search) {
    const safe = String(search).replace(/[\\%_]/g, ch => '\\' + ch)
    where.push("description LIKE ? ESCAPE '\\'")
    params.push(`${safe}%`)
  }

  return {
    whereClause: where.length ? `WHERE ${where.join(' AND ')}` : '',
    params,
  }
}

/** GET /api/transactions — list transactions with optional filters */
router.get('/', (req, res) => {
  const { page = 1, limit = 50 } = req.query
  const { whereClause, params } = buildTxnFilters(req.query)

  // Validate pagination: page >= 1, limit 1..500 (cap protects memory/perf).
  const limitN = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500)
  const pageN  = Math.max(parseInt(page, 10) || 1, 1)
  const offset = (pageN - 1) * limitN

  const db = getDb()

  const total = db.prepare(
    `SELECT COUNT(*) as count FROM transactions ${whereClause}`
  ).get(...params).count

  const rows = db.prepare(`
    SELECT id, external_id, date, processed_date, amount, original_currency,
           charged_amount, charged_currency, description, memo, note, category,
           category_manual,
           owner, account_id, account_number, account_name, source, card_last4, type,
           installment_number, installment_total, status, is_transfer,
           (SELECT label FROM subaccount_labels sl
              WHERE sl.account_id = transactions.account_id
                AND sl.account_number = transactions.account_number) AS account_label
    FROM transactions
    ${whereClause}
    ORDER BY date DESC, id DESC
    LIMIT ? OFFSET ?
  `).all(...params, limitN, offset)

  res.json({ total, page: pageN, limit: limitN, rows })
})

/**
 * POST /api/transactions — add a transaction by hand (e.g. a cash payment).
 * Body: { date 'YYYY-MM-DD', description, amount (signed: -expense/+income),
 *         category?, owner?, account_id? }.
 */
router.post('/', (req, res) => {
  const { date, description, amount, category, owner, account_id } = req.body || {}
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
    return res.status(400).json({ error: 'date (YYYY-MM-DD) is required' })
  }
  if (!description || !String(description).trim()) {
    return res.status(400).json({ error: 'description is required' })
  }
  const amt = Number(amount)
  if (!Number.isFinite(amt) || amt === 0) {
    return res.status(400).json({ error: 'amount must be a non-zero number' })
  }
  const db = getDb()
  let account_name = null
  if (account_id) {
    const a = db.prepare(`SELECT name FROM accounts WHERE id = ?`).get(Number(account_id))
    if (!a) return res.status(400).json({ error: 'account not found' })
    account_name = a.name
  }
  const id = insertManualTransaction(db, {
    date, description: String(description).trim(), amount: amt,
    category, owner, account_id: account_id ? Number(account_id) : null, account_name,
  })
  res.json({ id, message: 'Transaction added' })
})

/**
 * PUT /api/transactions/bulk/category — set a category for many transactions at
 * once (the checkbox multi-select in the UI). Two modes:
 *   { ids: [1,2,3], category }            — update these exact rows
 *   { filters: {...}, category }          — update ALL rows matching the given
 *     filters (same keys as the GET query params), for "select all filtered".
 * Every updated row is marked category_manual = 1 (protected from rules/scrapes).
 * Returns { updated }.
 * NOTE: must be registered BEFORE /:id/category, or Express would match this
 * path with id = 'bulk'.
 */
router.put('/bulk/category', (req, res) => {
  const { ids, filters, category } = req.body || {}
  if (!category || !String(category).trim()) {
    return res.status(400).json({ error: 'category is required' })
  }
  const cat = String(category).trim()
  const db = getDb()

  if (Array.isArray(ids) && ids.length > 0) {
    const updated = bulkSetCategory(db, ids, cat)
    return res.json({ message: 'Categories updated', updated })
  }

  if (filters && typeof filters === 'object') {
    const { whereClause, params } = buildTxnFilters(filters)
    if (!whereClause) {
      // Refuse a filterless bulk update — it would rewrite the entire table.
      return res.status(400).json({ error: 'filters must not be empty' })
    }
    const updated = db.prepare(
      `UPDATE transactions
       SET category = ?, category_manual = 1, updated_at = datetime('now')
       ${whereClause}`
    ).run(cat, ...params).changes
    return res.json({ message: 'Categories updated', updated })
  }

  res.status(400).json({ error: 'ids or filters are required' })
})

/** PUT /api/transactions/:id/category — manually set a category */
router.put('/:id/category', (req, res) => {
  const { category } = req.body
  if (!category) return res.status(400).json({ error: 'category is required' })
  const db = getDb()
  // category_manual = 1: the user chose this by hand — rules and future
  // re-categorization passes must never overwrite it.
  db.prepare(
    `UPDATE transactions SET category = ?, category_manual = 1, updated_at = datetime('now') WHERE id = ?`
  ).run(category, req.params.id)
  res.json({ message: 'Category updated' })
})

/** PUT /api/transactions/:id/note — set or clear the user's free-text note */
router.put('/:id/note', (req, res) => {
  const note = String(req.body?.note ?? '').slice(0, 1000)
  const db = getDb()
  db.prepare(
    `UPDATE transactions SET note = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(note, req.params.id)
  res.json({ message: 'Note updated', note })
})

/** GET /api/transactions/export/csv — download all as CSV */
router.get('/export/csv', (req, res) => {
  const db = getDb()
  const rows = db.prepare(`
    SELECT date, description, amount, original_currency, category, owner,
           source, account_name, card_last4, status, note
    FROM transactions ORDER BY date DESC
  `).all()

  const header = 'date,description,amount,currency,category,owner,source,account,card,status,note\n'
  const csv = rows.map(r =>
    [r.date, csvSafeText(r.description),
     r.amount, r.original_currency, csvSafeText(r.category), csvSafeText(r.owner),
     csvSafeText(r.source), csvSafeText(r.account_name), csvSafeText(r.card_last4), r.status,
     csvSafeText(r.note)].join(',')
  ).join('\n')

  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', 'attachment; filename="transactions.csv"')
  res.send('﻿' + header + csv)  // BOM for Excel Hebrew support
})

export default router
