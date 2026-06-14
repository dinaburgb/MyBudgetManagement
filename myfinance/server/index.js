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

import { openDatabase, closeDatabase } from './db/database.js'
import { isUnlocked, clearKey, isPasswordSet, unlockOrInit,
         changeMasterPassword, resetMasterPassword } from './crypto/encryption.js'
import accountsRouter from './routes/accounts.js'
import transactionsRouter from './routes/transactions.js'
import scrapeRouter from './routes/scrape.js'
import categoriesRouter from './routes/categories.js'
import budgetsRouter from './routes/budgets.js'
import statsRouter from './routes/stats.js'
import transfersRouter from './routes/transfers.js'
import assetsRouter from './routes/assets.js'
import { seedDefaultRules, migrateCategoriesToHebrew, ensureEssentialRules } from './db/categorize.js'
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
// Ensure authoritative keyword rules (רב קו→ילדים, דלק/מוסך→רכב, ...) exist and
// apply them once to existing data. Idempotent — added rules won't fight later edits.
const ess = ensureEssentialRules()
if (ess.added > 0) console.log(`Essential rules: added ${ess.added}, re-categorized ${ess.applied} transaction(s)`)

const app    = express()
const server = createServer(app)

// Allowed browser origins. The React app is served from this same origin (and in
// dev Vite proxies /api to here), so legit requests are same-origin. We allow
// ONLY localhost so a random site you have open can't reach localhost:3000.
const ALLOWED_ORIGINS = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',  // Vite dev server
  'http://127.0.0.1:5173',
])

// WebSocket for OTP popups — reject connections from unknown origins (H4).
const wss = new WebSocketServer({
  server,
  verifyClient: ({ origin }, cb) => {
    if (!origin || ALLOWED_ORIGINS.has(origin)) return cb(true)
    cb(false, 403, 'Forbidden origin')
  },
})

// CORS — mainly stops other origins from READING responses.
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

// State-changing requests must be same-origin (H3). CORS alone doesn't stop a
// foreign site from *sending* a POST/PUT/DELETE to localhost; this does. Browsers
// send Sec-Fetch-Site and Origin; non-browser callers (curl, tests) send neither
// and are allowed (local trust). This is a lightweight CSRF guard — no tokens.
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
app.use((req, res, next) => {
  if (!MUTATING.has(req.method)) return next()
  const site = req.get('sec-fetch-site')
  if (site && site !== 'same-origin' && site !== 'none') {
    return res.status(403).json({ error: 'Cross-site request blocked' })
  }
  const origin = req.get('origin')
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return res.status(403).json({ error: 'Cross-origin request blocked' })
  }
  next()
})

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

  // unlockOrInit safely handles a missing sentinel: it only re-initialises when
  // there are no stored credentials, or recreates the sentinel when the password
  // actually decrypts existing credentials. Otherwise it's a wrong password.
  const status = unlockOrInit(password)
  if (status === false) return res.status(401).json({ error: 'Wrong password' })
  res.json({ status })
})

/** GET /api/auth/status — is the app unlocked, and has a password been set? */
app.get('/api/auth/status', (req, res) => {
  res.json({ unlocked: isUnlocked(), passwordSet: isPasswordSet() })
})

/**
 * POST /api/auth/change-password — change the app's master password.
 * Body: { oldPassword, newPassword }. Re-encrypts stored bank credentials under
 * the new key. Available from the lock screen (no unlock check needed: the old
 * password is verified inside).
 */
app.post('/api/auth/change-password', (req, res) => {
  const { oldPassword, newPassword } = req.body || {}
  if (!oldPassword || !newPassword) return res.status(400).json({ error: 'Old and new passwords are required' })
  if (String(newPassword).length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' })
  try {
    const { reencrypted } = changeMasterPassword(oldPassword, newPassword)
    res.json({ status: 'changed', reencrypted })
  } catch (err) {
    if (err.code === 'WRONG_PASSWORD') return res.status(401).json({ error: 'Wrong current password' })
    console.error('[auth] change-password failed:', err.message)
    res.status(500).json({ error: 'Could not change password' })
  }
})

/**
 * POST /api/auth/reset — forgot master password. Wipes the encryption material
 * and the (unrecoverable) stored bank credentials, but keeps all financial data.
 * Requires an explicit confirmation token to avoid accidents.
 */
app.post('/api/auth/reset', (req, res) => {
  if ((req.body || {}).confirm !== 'RESET') {
    return res.status(400).json({ error: 'Confirmation required' })
  }
  const { clearedAccounts } = resetMasterPassword()
  res.json({ status: 'reset', clearedAccounts })
})

/** POST /api/auth/lock — clear key from memory */
app.post('/api/auth/lock', (req, res) => {
  clearKey()
  res.json({ status: 'locked' })
})

/**
 * POST /api/app/shutdown — close the app cleanly: clear the key, close the
 * WebSocket + HTTP server and the database, then exit. Behind the same-origin
 * guard, so a foreign site can't trigger it.
 */
app.post('/api/app/shutdown', (req, res) => {
  res.json({ status: 'closing' })
  clearKey()
  console.log('Shutdown requested — closing cleanly...')
  // Let the response flush, then tear everything down.
  setTimeout(() => {
    try { wss.close() } catch { /* ignore */ }
    try { closeDatabase() } catch { /* ignore */ }
    server.close(() => process.exit(0))
    // Hard fallback if something keeps the event loop alive.
    setTimeout(() => process.exit(0), 1500).unref?.()
  }, 150)
})

// --- API routes ---
app.use('/api/accounts',     accountsRouter)
app.use('/api/transactions', transactionsRouter)
app.use('/api/scrape',       scrapeRouter)
app.use('/api/categories',   categoriesRouter)
app.use('/api/budgets',      budgetsRouter)
app.use('/api/stats',        statsRouter)
app.use('/api/transfers',    transfersRouter)
app.use('/api/assets',       assetsRouter)

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
