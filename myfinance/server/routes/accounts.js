/**
 * Accounts API — manage bank/card credentials.
 * Credentials are always stored encrypted; never returned in plain text.
 */

import { Router } from 'express'
import { getDb } from '../db/database.js'
import { encrypt, decrypt, isUnlocked } from '../crypto/encryption.js'

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
    SELECT id, name, source, owner, last_scraped, enabled, created_at
    FROM accounts ORDER BY source, owner
  `).all()
  res.json(accounts)
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

/** DELETE /api/accounts/:id — remove an account */
router.delete('/:id', (req, res) => {
  const db = getDb()
  db.prepare(`DELETE FROM accounts WHERE id = ?`).run(req.params.id)
  res.json({ message: 'Account deleted' })
})

/**
 * GET /api/accounts/:id/credentials — return decrypted credentials.
 * Only used internally by the scraper; not exposed in the UI directly.
 */
router.get('/:id/credentials', (req, res) => {
  const db = getDb()
  const account = db.prepare(`SELECT credentials FROM accounts WHERE id = ?`).get(req.params.id)
  if (!account) return res.status(404).json({ error: 'Account not found' })
  try {
    const plain = decrypt(account.credentials)
    res.json(JSON.parse(plain))
  } catch {
    res.status(500).json({ error: 'Failed to decrypt credentials' })
  }
})

export default router
