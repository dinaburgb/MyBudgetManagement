/**
 * Transactions API — read and filter transactions.
 */

import { Router } from 'express'
import { getDb } from '../db/database.js'
import { isUnlocked } from '../crypto/encryption.js'
import { notExcludedSql } from '../db/subaccounts.js'
import { insertManualTransaction } from '../db/save-transactions.js'
import { csvSafeText } from '../util/csv.js'

const router = Router()

router.use((req, res, next) => {
  if (!isUnlocked()) return res.status(401).json({ error: 'App is locked' })
  next()
})

/** GET /api/transactions — list transactions with optional filters */
router.get('/', (req, res) => {
  const {
    owner, source, category, status,
    account_id, exclude_account_id,
    only_in_totals,
    date_from, date_to,
    amount_min, amount_max,
    search,
    page = 1, limit = 50
  } = req.query

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
  // Only transactions from accounts the user includes in totals
  if (only_in_totals === '1') {
    where.push('account_id IN (SELECT id FROM accounts WHERE include_in_totals = 1)')
    where.push(notExcludedSql('transactions.account_id', 'transactions.account_number'))
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

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : ''
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
           owner, account_id, account_name, source, card_last4, type,
           installment_number, installment_total, status
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

/** PUT /api/transactions/:id/category — manually set a category */
router.put('/:id/category', (req, res) => {
  const { category } = req.body
  if (!category) return res.status(400).json({ error: 'category is required' })
  const db = getDb()
  db.prepare(
    `UPDATE transactions SET category = ?, updated_at = datetime('now') WHERE id = ?`
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
