/**
 * MyFinance — main server entry point.
 *
 * What this file does:
 *   1. Opens the SQLite database
 *   2. Starts an Express HTTP server on port 3000
 *   3. Serves the React frontend (built files)
 *   4. Handles API routes for accounts, transactions, and scraping
 *   5. Sets up a WebSocket server for OTP popups (Phase 3)
 */

import express from 'express'
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import cors from 'cors'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { openDatabase } from './db/database.js'
import { deriveKey, isUnlocked, verifyPassword, savePasswordSentinel, clearKey } from './crypto/encryption.js'
import accountsRouter from './routes/accounts.js'
import transactionsRouter from './routes/transactions.js'
import scrapeRouter from './routes/scrape.js'
import categoriesRouter from './routes/categories.js'
import budgetsRouter from './routes/budgets.js'
import statsRouter from './routes/stats.js'
import { seedDefaultRules, migrateCategoriesToHebrew } from './db/categorize.js'
import { seedCategories, migrateFuelToVehicle } from './db/categories.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CLIENT_DIST = path.join(__dirname, '..', 'client', 'dist')

// --- Initialise ---
openDatabase()
// Seed the canonical category list on first run (no-op once categories exist).
seedCategories()
// Broaden the legacy fuel category 'דלק' into 'רכב' (one-time, idempotent).
migrateFuelToVehicle()
// Seed default auto-categorization rules on first run (no-op if rules exist).
seedDefaultRules()
// Convert any legacy English / scraper-Hebrew categories to our canonical Hebrew
// set (idempotent — does nothing once everything is already canonical).
const migratedCats = migrateCategoriesToHebrew()
if (migratedCats > 0) console.log(`Migration: normalized ${migratedCats} category value(s) to Hebrew`)

const app    = express()
const server = createServer(app)
const wss    = new WebSocketServer({ server })  // WebSocket for OTP popups

// CORS — locked down. The React app is served from this same origin (and in dev
// Vite proxies /api to here), so browser requests are same-origin and need no
// CORS at all. We allow ONLY localhost origins so that an arbitrary website you
// happen to have open cannot read your financial data from localhost:3000 while
// the app is unlocked. Any other origin is rejected.
const ALLOWED_ORIGINS = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',  // Vite dev server
  'http://127.0.0.1:5173',
])
app.use(cors({
  origin(origin, callback) {
    // No Origin header (same-origin requests, curl, server-to-server) → allow.
    if (!origin || ALLOWED_ORIGINS.has(origin)) return callback(null, true)
    // Unknown origin: respond normally but WITHOUT the CORS header, so the
    // browser blocks the other site from reading the response (no 500 noise).
    return callback(null, false)
  },
}))
app.use(express.json())

// Serve compiled React app
app.use(express.static(CLIENT_DIST))

// --- Auth endpoints (no lock check — these handle unlocking) ---

/**
 * POST /api/auth/unlock
 * Body: { password: "..." }
 * First call (no sentinel yet): creates sentinel, saves it, unlocks.
 * Subsequent calls: verifies password against sentinel.
 */
app.post('/api/auth/unlock', (req, res) => {
  const { password } = req.body
  if (!password) return res.status(400).json({ error: 'Password is required' })

  const result = verifyPassword(password)

  if (result === null) {
    // First run — no sentinel exists yet. Set up the password.
    deriveKey(password)
    savePasswordSentinel()
    return res.json({ status: 'first_run', message: 'Master password set. Keep it safe — it cannot be recovered.' })
  }

  if (result === false) {
    return res.status(401).json({ error: 'Wrong password' })
  }

  // result === true — password correct, key already derived inside verifyPassword
  res.json({ status: 'unlocked' })
})

/** GET /api/auth/status — is the app currently unlocked? */
app.get('/api/auth/status', (req, res) => {
  res.json({ unlocked: isUnlocked() })
})

/** POST /api/auth/lock — clear key from memory */
app.post('/api/auth/lock', (req, res) => {
  clearKey()
  res.json({ status: 'locked' })
})

// --- API routes ---
app.use('/api/accounts',     accountsRouter)
app.use('/api/transactions', transactionsRouter)
app.use('/api/scrape',       scrapeRouter)
app.use('/api/categories',   categoriesRouter)
app.use('/api/budgets',      budgetsRouter)
app.use('/api/stats',        statsRouter)

// --- Fallback: serve React for all non-API routes ---
app.get('*', (req, res) => {
  res.sendFile(path.join(CLIENT_DIST, 'index.html'))
})

// --- WebSocket: broadcast OTP requests to connected browsers (Phase 3) ---
export function broadcastOtpRequest(accountName) {
  wss.clients.forEach(client => {
    if (client.readyState === 1 /* OPEN */) {
      client.send(JSON.stringify({ type: 'otp_required', account: accountName }))
    }
  })
}

// --- Start ---
const PORT = 3000
// Bind to loopback only (127.0.0.1) so the app is reachable ONLY from this
// machine, never from other devices on the local network/Wi-Fi.
const HOST = '127.0.0.1'
server.listen(PORT, HOST, () => {
  console.log(`\n✅ MyFinance is running at http://localhost:${PORT}`)
  console.log(`   Open your browser and go to: http://localhost:${PORT}\n`)
})
