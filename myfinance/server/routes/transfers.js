/**
 * Internal-transfers API. The app suggests likely transfer pairs; the user
 * confirms (mark) or rejects (ignore) each one. Nothing is removed from totals
 * without confirmation.
 *
 *   GET  /api/transfers/candidates   suggested pairs (+ count)
 *   POST /api/transfers/mark         { a_id, b_id } → flag both legs
 *   POST /api/transfers/ignore       { a_id, b_id } → never suggest again
 *   POST /api/transfers/unmark       { id }         → clear the flag on one txn
 */

import { Router } from 'express'
import { getDb } from '../db/database.js'
import { isUnlocked } from '../crypto/encryption.js'
import {
  findTransferCandidates, markTransferPair, ignoreTransferPair, unmarkTransfer,
} from '../db/transfers.js'

const router = Router()

router.use((req, res, next) => {
  if (!isUnlocked()) return res.status(401).json({ error: 'App is locked' })
  next()
})

router.get('/candidates', (req, res) => {
  const pairs = findTransferCandidates(getDb())
  res.json({ count: pairs.length, pairs })
})

router.post('/mark', (req, res) => {
  const { a_id, b_id } = req.body || {}
  if (!a_id || !b_id) return res.status(400).json({ error: 'a_id and b_id are required' })
  markTransferPair(getDb(), Number(a_id), Number(b_id))
  res.json({ message: 'Marked as transfer' })
})

router.post('/ignore', (req, res) => {
  const { a_id, b_id } = req.body || {}
  if (!a_id || !b_id) return res.status(400).json({ error: 'a_id and b_id are required' })
  ignoreTransferPair(getDb(), Number(a_id), Number(b_id))
  res.json({ message: 'Pair ignored' })
})

router.post('/unmark', (req, res) => {
  const { id } = req.body || {}
  if (!id) return res.status(400).json({ error: 'id is required' })
  unmarkTransfer(getDb(), Number(id))
  res.json({ message: 'Transfer flag cleared' })
})

export default router
