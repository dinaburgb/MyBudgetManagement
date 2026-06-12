/**
 * Transactions API — read and filter transactions.
 */

import { Router } from 'express'
import { getDb } from '../db/database.js'
import { isUnlocked } from '../crypto/encryption.js'

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

  if (owner)      { where.push('owner = ?');      params.push(owner) }
  if (source)     { where.push('source = ?');     params.push(source) }
  if (category)   { where.push('category = ?');   params.push(category) }
  if (status)     { where.push('status = ?');     params.push(status) }
  if (account_id) { where.push('account_id = ?'); params.push(Number(account_id)) }
  if (exclude_account_id) { where.push('account_id != ?'); params.push(Number(exclude_account_id)) }
  // Only transactions from accounts the user includes in totals
  if (only_in_totals === '1') {
    where.push('account_id IN (SELECT id FROM accounts WHERE include_in_totals = 1)')
  }
  if (date_from)  { where.push('date >= ?');      params.push(date_from) }
  if (date_to)    { where.push('date <= ?');      params.push(date_to) }
  if (amount_min) { where.push('amount >= ?');    params.push(Number(amount_min)) }
  if (amount_max) { where.push('amount <= ?');    params.push(Number(amount_max)) }
  if (search)     { where.push('description LIKE ?'); params.push(`%${search}%`) }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const offset = (Number(page) - 1) * Number(limit)

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
  `).all(...params, Number(limit), offset)

  res.json({ total, page: Number(page), limit: Number(limit), rows })
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
    [r.date, `"${(r.description || '').replace(/"/g, '""')}"`,
     r.amount, r.original_currency, r.category, r.owner,
     r.source, r.account_name, r.card_last4, r.status,
     `"${(r.note || '').replace(/"/g, '""')}"`].join(',')
  ).join('\n')

  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', 'attachment; filename="transactions.csv"')
  res.send('﻿' + header + csv)  // BOM for Excel Hebrew support
})

export default router
