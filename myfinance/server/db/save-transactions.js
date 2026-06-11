/**
 * Transaction saving with deduplication.
 *
 * Deduplication strategy (per project rules):
 *   - If the bank gives a stable identifier, use it as the dedup key.
 *   - Otherwise, build a hash from:
 *       source + account_number + date + amount + normalized_description + currency
 *   - The raw payload from the scraper is ALWAYS stored and never discarded.
 *   - Pending transactions that later become completed UPDATE the existing row
 *     instead of creating a duplicate.
 */

import crypto from 'node:crypto'
import { getDb } from './database.js'

/**
 * Normalize a description for hashing:
 * lowercase, collapse whitespace, strip punctuation/special chars.
 */
function normalizeDescription(desc) {
  return (desc || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')  // remove anything that's not a letter/number/space
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Compute a content hash for a transaction from its distinguishing fields.
 *
 * We do NOT use the bank's own identifier as the key: some banks (e.g. FIBI)
 * reuse the same "reference" number for every payment to the same payee, so it
 * is a payee code, not a per-transaction id. Hashing the actual content
 * (date + amount + description + currency) distinguishes recurring payments
 * correctly, and stays stable across re-imports and pending→completed changes.
 *
 * Exported so the one-time migration can recompute keys for existing rows
 * using exactly the same logic.
 */
export function computeContentHash(source, accountNumber, dateYMD, amount, description, currency) {
  const parts = [
    source,
    accountNumber || '',
    (dateYMD || '').slice(0, 10),
    Number(amount).toFixed(2),            // stable numeric representation
    normalizeDescription(description),
    currency || 'ILS',
  ].join('|')
  return crypto.createHash('sha256').update(parts).digest('hex')
}

/**
 * Save one bank account's transactions to the database.
 *
 * @param {object} account   - the account row from our DB (id, source, owner, ...)
 * @param {object} scrapedAccount - { accountNumber, balance, txns: [...] }
 * @param {object} [dbOverride] - optional DB connection (used by tests)
 * @returns {object} stats { inserted, updated, skipped }
 */
export function saveAccountTransactions(account, scrapedAccount, dbOverride) {
  const db = dbOverride || getDb()
  const { accountNumber, txns = [] } = scrapedAccount

  // Prepared statements (reused in the loop for speed)
  const findStmt = db.prepare(`SELECT id, status FROM transactions WHERE dedup_key = ?`)

  const insertStmt = db.prepare(`
    INSERT INTO transactions (
      external_id, dedup_key, raw_payload_json,
      date, processed_date, amount,
      original_amount, original_currency, charged_amount, charged_currency,
      description, memo, category, owner,
      account_id, account_number, account_name, source, card_last4,
      type, installment_number, installment_total, status
    ) VALUES (
      @external_id, @dedup_key, @raw_payload_json,
      @date, @processed_date, @amount,
      @original_amount, @original_currency, @charged_amount, @charged_currency,
      @description, @memo, @category, @owner,
      @account_id, @account_number, @account_name, @source, @card_last4,
      @type, @installment_number, @installment_total, @status
    )
  `)

  // Update path: used when a pending txn becomes completed, or amounts change
  const updateStmt = db.prepare(`
    UPDATE transactions SET
      raw_payload_json = @raw_payload_json,
      processed_date   = @processed_date,
      amount           = @amount,
      charged_amount   = @charged_amount,
      status           = @status,
      updated_at       = datetime('now')
    WHERE id = @id
  `)

  let inserted = 0, updated = 0, skipped = 0

  // Track how many times each content hash appears within THIS import, so that
  // genuinely identical transactions on the same day (same amount/description)
  // are kept as separate rows instead of being collapsed into one. The Nth
  // occurrence gets suffix ":N". Re-imports produce the same sequence, so they
  // still dedup correctly.
  const occurrence = new Map()

  // Wrap in a transaction for speed and atomicity.
  // node:sqlite has no .transaction() helper, so we use explicit BEGIN/COMMIT.
  db.exec('BEGIN')
  try {
    for (const txn of txns) {
      const baseHash = computeContentHash(
        account.source, accountNumber, txn.date, txn.chargedAmount,
        txn.description, txn.originalCurrency,
      )
      const occ = occurrence.get(baseHash) || 0
      occurrence.set(baseHash, occ + 1)
      const dedupKey = `${baseHash}:${occ}`
      const existing = findStmt.get(dedupKey)

      const row = {
        external_id: txn.identifier != null ? String(txn.identifier) : null,
        dedup_key: dedupKey,
        raw_payload_json: JSON.stringify(txn),
        date: txn.date ? txn.date.slice(0, 10) : null,
        processed_date: txn.processedDate ? txn.processedDate.slice(0, 10) : null,
        amount: txn.chargedAmount,
        original_amount: txn.originalAmount,
        original_currency: txn.originalCurrency || 'ILS',
        charged_amount: txn.chargedAmount,
        charged_currency: txn.chargedCurrency || 'ILS',
        description: txn.description || '',
        memo: txn.memo || '',
        category: txn.category || 'Other',
        owner: account.owner,
        account_id: account.id,
        account_number: accountNumber,
        account_name: account.name,
        source: account.source,
        card_last4: null,
        type: txn.type === 'installments' ? 'installment' : 'normal',
        installment_number: txn.installments?.number ?? null,
        installment_total: txn.installments?.total ?? null,
        status: txn.status || 'completed',
      }

      if (!existing) {
        insertStmt.run(row)
        inserted++
      } else if (existing.status === 'pending' && row.status === 'completed') {
        // Pending → completed: update the existing row instead of duplicating.
        // node:sqlite rejects extra named params, so pass only what the statement uses.
        updateStmt.run({
          id: existing.id,
          raw_payload_json: row.raw_payload_json,
          processed_date: row.processed_date,
          amount: row.amount,
          charged_amount: row.charged_amount,
          status: row.status,
        })
        updated++
      } else {
        skipped++  // already have this transaction, nothing changed
      }
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  return { inserted, updated, skipped }
}
