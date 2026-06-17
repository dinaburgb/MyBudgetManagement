# MyBudgetManagement — Security & Architecture Review

Date: 2026-06-12
Branch reviewed: `feature/phase2-scraping`
Scope: review + safe fixes only. No bank connections, no scraping, no real
credentials, no history rewrite, no remote push.

## Executive summary

The project is in good shape security-wise. No real credentials, tokens, OTPs,
cookies, database files, logs, or personal financial data are tracked by Git.
Encryption (AES-256-GCM + PBKDF2) is implemented correctly, the master password is
never stored, and the browser never uses `localStorage`/`sessionStorage`.

Two notable issues were found and **fixed**: an unused HTTP endpoint that returned
decrypted credentials, and the server listening on all network interfaces. A
personal-profile prompt doc was removed from Git tracking. Several lower-priority
hardening items are recommended below.

All local tests pass: **14/14** (8 dedup + 6 encryption), using fake data only.

## Critical issues

None.

## High priority issues

- **H1 — Decrypted-credentials HTTP endpoint (FIXED).**
  `GET /api/accounts/:id/credentials` returned plaintext bank credentials as JSON.
  It was unused (the scraper decrypts in memory server-side). Any local process or
  page reaching `localhost:3000` while unlocked could have fetched credentials.
  → Removed the endpoint and the now-unused `decrypt` import; added a comment
  documenting that plaintext credentials must never be exposed over HTTP.

- **H2 — Server bound to all network interfaces (FIXED).**
  `server.listen(3000)` bound to `0.0.0.0`, making the app reachable from other
  devices on the same LAN/Wi-Fi. → Now binds to `127.0.0.1` (loopback only).

## Medium priority issues

- **M1 — PBKDF2 iteration count (recommendation, not changed).**
  100,000 iterations (SHA-512) is below current OWASP guidance. Not increased
  automatically because it would change key derivation and break decryption of
  already-stored credentials. Recommend raising to ~210,000+ **together with a
  one-time re-encryption** (re-enter credentials or migrate) in a future change.

- **M2 — Personal prompt doc removed from Git (FIXED).**
  `docs/INSTRUCTIONS.md` contained a personal profile (age, profession, family
  names). → Untracked via `git rm --cached`, added to `.gitignore`, and replaced
  with a neutral `docs/DEVELOPMENT_GUIDE.md` (no personal data, no secrets). The
  local file is kept but no longer tracked. NOTE: it still exists in earlier Git
  history; rewriting history was intentionally NOT done (out of scope). Do that
  only if you decide the repo will be shared.

- **M3 — Failure screenshots may show on-screen bank data (mitigated).**
  `storeFailureScreenShotPath` writes a screenshot of the live bank page to
  `logs/` on login failure; it can show the username/account on screen. `logs/` is
  git-ignored and a privacy warning comment was added. Recommend gating it behind a
  debug flag and clearing old screenshots when not debugging.

- **M4 — Missing DB indexes (FIXED).**
  Added indexes on `category` and `account_id` (date/source/owner already existed;
  `dedup_key` is covered by its UNIQUE constraint).

## Low priority issues

- **L1 — Owner names hardcoded.** Owner names were previously hardcoded defaults in
  code/UI. Now derived from accounts (user-configurable). An "Other" option exists.
- **L2 — Full account numbers shown in the post-sync breakdown** on AccountsPage.
  Local-only, the user's own data. Consider masking to the last 4 digits.
- **L3 — Scraper logs `err.message`.** These are library/Puppeteer messages, not
  credentials. Low risk; left as-is for debuggability.
- **L4 — Dependency vulnerabilities.** `npm install` reported a few "moderate"
  advisories (transitive). Not deeply audited here; run `npm audit` and review.

## Encryption review (findings)

- AES-256-GCM used correctly: random 12-byte IV per encryption, auth tag stored and
  verified on decrypt (tampering is rejected), 32-byte key. ✓
- Salt is random (32 bytes), generated once, stored in `data/salt.bin` (ignored),
  not hardcoded. ✓
- Master password never written to disk; only the derived key is held in memory and
  zeroed on `clearKey()`. ✓
- Decrypted credentials are never logged and (after H1) never returned over HTTP. ✓
- PBKDF2 iterations are low — see M1.

## Database review (findings)

- DB created under git-ignored `data/`. ✓
- Schema has all dedup fields and `raw_payload_json`. ✓
- `dedup_key` has a UNIQUE constraint; indexes now cover date/source/owner/
  category/account. ✓
- pending → completed updates the existing row instead of duplicating. ✓
- `raw_payload_json` is stored but never selected by the transactions API or CSV
  export, and not shown in the UI. ✓

## Scraper review (findings)

- No hardcoded credentials; credentials decrypted in memory only and cleared after
  use. ✓
- OTP/SMS codes are entered by the user in the browser and never stored or logged. ✓
- One bank failing does not stop others (`/api/scrape/all` continues per account). ✓
- Library patches are documented in code and captured via patch-package
  (`patches/israeli-bank-scrapers+6.7.5.patch`): Discount (new `retail3` SPA + wait),
  Hapoalim (field-readiness, blur-before-submit, manual OTP wait), and a shared
  fill-input verify/retry. ✓

## Frontend review (findings)

- No `localStorage`/`sessionStorage` anywhere. ✓
- Credentials are sent only on save (POST/PUT) and never read back or stored in the
  browser. ✓
- Transaction table shows date/description/amount/category/owner/source — no raw
  payload, no full account numbers. ✓
- Errors are human-readable and contain no secrets. ✓
- See L2 for full account numbers in the sync breakdown.

## Dependency review (findings)

- No cloud/auth/analytics/telemetry packages. Stack: express, cors, ws,
  israeli-bank-scrapers (+puppeteer), axios, react, recharts, lucide-react;
  dev: vite, tailwind, patch-package. ✓
- `israeli-bank-scrapers` pinned at 6.7.5 with a committed patch and a
  `postinstall: patch-package` script. ✓
- Scripts are Windows-friendly (`node`, `vite`). See L4 re: `npm audit`.

## Files changed during review

- `.gitignore` (root) — comprehensive secret/data patterns; ignore INSTRUCTIONS.md
- `docs/INSTRUCTIONS.md` — untracked (kept locally)
- `docs/DEVELOPMENT_GUIDE.md` — new, neutral
- `docs/REVIEW_REPORT.md` — this report
- `README.md` — added Security section
- `myfinance/server/routes/accounts.js` — removed decrypted-credentials endpoint + unused import
- `myfinance/server/index.js` — bind to 127.0.0.1
- `myfinance/server/db/schema.js` — added category/account indexes
- `myfinance/server/scrapers/scraper.js` — screenshot privacy warning comment
- `myfinance/tests/test_encryption.js` — new encryption round-trip tests (fake data)

## What was NOT checked

- No live bank connections or scraping (per constraints).
- Git history was not rewritten; personal info from earlier commits remains in
  history (see M2).
- No deep dependency CVE audit / `npm audit fix` was run.
- No full penetration test of the running server (CSRF, etc.) beyond the network
  binding and the credentials endpoint.

## Recommended next steps before adding more banks

1. Decide on M1: raise PBKDF2 iterations with a credential re-encryption step.
2. Decide whether the repo will ever be shared; if so, rewrite history to drop the
   old `INSTRUCTIONS.md` (M2).
3. Optionally gate failure screenshots behind a debug flag (M3) and mask account
   numbers in the UI (L2).
4. Run `npm audit` and address advisories (L4).
5. Consider basic CSRF protection / a simple same-origin check on state-changing
   API routes, since the server holds financial data while unlocked.
