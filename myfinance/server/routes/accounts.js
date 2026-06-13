/**
 * Accounts API — manage bank/card credentials.
 * Credentials are always stored encrypted; never returned in plain text.
 */

import { Router } from 'express'
import { getDb } from '../db/database.js'
import { encrypt, isUnlocked } from '../crypto/encryption.js'
import { balancesByAccount } from '../db/balances.js'
import { deleteAccount } from '../db/accounts.js'
import { listSubAccounts, setSubAccountIncluded } from '../db/subaccounts.js'

const router = Router()

// Middleware: all account routes require the app to be unlocked
router.use((req, res, next) => {
  if (!isUnlocked()) {
    return res.status(401).json({ error: 'App is locked. Enter master password first.' })
  }
  next()
})

/** GET /api/accounts — list all accounts (credentials are NOT returned) */
router.get('/', (req, res) => {
  const db = getDb()
  const accounts = db.prepare(`
    SELECT id, name, source, owner, last_scraped, enabled, include_in_totals, created_at,
           (SELECT COUNT(*) FROM transactions t WHERE t.account_id = accounts.id) AS txn_count,
           (SELECT COUNT(DISTINCT t.account_number) FROM transactions t
              WHERE t.account_id = accounts.id AND t.account_number IS NOT NULL) AS subaccount_count,
           (SELECT COUNT(*) FROM excluded_subaccounts e WHERE e.account_id = accounts.id) AS excluded_count
    FROM accounts ORDER BY source, owner
  `).all()
  // Attach the latest known balance per account (null when unknown, e.g. cards).
  const balances = balancesByAccount(db)
  for (const a of accounts) {
    const b = balances.get(a.id)
    a.balance = b ? b.balance : null
    a.balance_date = b ? b.balance_date : null
  }
  res.json(accounts)
})

/** GET /api/accounts/:id/subaccounts — the account numbers under one login */
router.get('/:id/subaccounts', (req, res) => {
  res.json(listSubAccounts(getDb(), Number(req.params.id)))
})

/** PUT /api/accounts/:id/subaccounts — include/exclude one number { account_number, include } */
router.put('/:id/subaccounts', (req, res) => {
  const { account_number, include } = req.body
  if (!account_number) return res.status(400).json({ error: 'account_number is required' })
  setSubAccountIncluded(getDb(), Number(req.params.id), String(account_number), !!include)
  res.json({ message: 'Sub-account updated' })
})

/** POST /api/accounts — add a new account with encrypted credentials */
router.post('/', (req, res) => {
  const { name, source, owner, credentials } = req.body

  if (!name || !source || !credentials) {
    return res.status(400).json({ error: 'name, source, and credentials are required' })
  }

  // Validate credentials is valid JSON before encrypting
  try { JSON.parse(credentials) } catch {
    return res.status(400).json({ error: 'credentials must be valid JSON' })
  }

  const encrypted = encrypt(credentials)
  const db = getDb()
  const result = db.prepare(`
    INSERT INTO accounts (name, source, owner, credentials)
    VALUES (?, ?, ?, ?)
  `).run(name, source, owner || 'Boris', encrypted)

  res.json({ id: result.lastInsertRowid, message: 'Account saved' })
})

/** PUT /api/accounts/:id — update an account */
router.put('/:id', (req, res) => {
  const { name, source, owner, credentials, enabled } = req.body
  const db = getDb()
  const existing = db.prepare(`SELECT id FROM accounts WHERE id = ?`).get(req.params.id)
  if (!existing) return res.status(404).json({ error: 'Account not found' })

  // Build update query dynamically — only update provided fields
  const updates = []
  const values  = []

  if (name      !== undefined) { updates.push('name = ?');    values.push(name) }
  if (source    !== undefined) { updates.push('source = ?');  values.push(source) }
  if (owner     !== undefined) { updates.push('owner = ?');   values.push(owner) }
  if (enabled   !== undefined) { updates.push('enabled = ?'); values.push(enabled ? 1 : 0) }
  if (req.body.include_in_totals !== undefined) {
    updates.push('include_in_totals = ?'); values.push(req.body.include_in_totals ? 1 : 0)
  }
  if (credentials !== undefined) {
    try { JSON.parse(credentials) } catch {
      return res.status(400).json({ error: 'credentials must be valid JSON' })
    }
    updates.push('credentials = ?')
    values.push(encrypt(credentials))
  }

  updates.push("updated_at = datetime('now')")
  values.push(req.params.id)

  db.prepare(`UPDATE accounts SET ${updates.join(', ')} WHERE id = ?`).run(...values)
  res.json({ message: 'Account updated' })
})

/**
 * DELETE /api/accounts/:id — remove an account.
 * By default keeps the account's transactions (they stay as history).
 * With ?withData=1 it also deletes the account's transactions and balances,
 * so nothing from this account appears anywhere ("clean account").
 */
router.delete('/:id', (req, res) => {
  const db = getDb()
  const withData = req.query.withData === '1' || req.query.withData === 'true'
  try {
    const { deletedTransactions } = deleteAccount(db, req.params.id, withData)
    res.json({ message: withData ? 'Account cleaned' : 'Account deleted', deletedTransactions })
  } catch {
    res.status(500).json({ error: 'Could not delete account' })
  }
})

// NOTE: There is deliberately NO endpoint that returns decrypted credentials.
// The scraper decrypts them in memory on the server side (see scrapers/scraper.js).
// Never expose plaintext credentials over HTTP.

export default router
