# MyBudgetManagement — Security and Architecture Review Brief for Claude

## Purpose

Please review and improve the **MyBudgetManagement** project, a local-first personal finance / budget management application.

The main goal is to strengthen privacy, local security, packaging hygiene, and backend/frontend robustness without changing the core product behavior.

This brief is based on a prior static review of the project ZIP. Please verify every point directly in the code before applying changes.

---

## Important Safety Context

This project handles sensitive personal financial data.

Do **not** connect to real banks, do **not** run real scraping against banking websites, and do **not** expose or print real financial records, credentials, logs, database contents, screenshots, or personal instructions.

Treat the ZIP as potentially containing private files. Before any sharing, publishing, or upload, create a sanitized code-only archive.

The application is intended to run locally on the user's machine, not as a public web service.

---

## High-Level Project Description

Expected project structure:

```text
myfinance/
  client/               # React/Vite frontend
  server/
    crypto/             # encryption / master password logic
    db/                 # SQLite schema and stores
    routes/             # Express API routes
    scrapers/           # scraping integration wrapper
  tests/                # Node-based tests
  data/                 # local private DB and encrypted secrets - must not be shared
  logs/                 # logs/screenshots - must not be shared
```

The app uses:

- Node.js / Express backend
- React / Vite frontend
- SQLite local database
- AES-256-GCM for encrypted bank credentials
- A master password-derived encryption key
- Localhost-only server binding

---

## Current Positive Findings

Please preserve these strengths:

1. Backend appears to bind to `127.0.0.1`, not all network interfaces.
2. Decrypted bank credentials are not returned through the API.
3. Bank credentials are encrypted using AES-256-GCM.
4. Random IVs and auth tags appear to be used.
5. The master password is not intentionally stored.
6. Frontend does not appear to use `localStorage` or `sessionStorage` for secrets.
7. No obvious `dangerouslySetInnerHTML` pattern was found.
8. SQL access appears mostly parameterized.
9. `.gitignore` correctly excludes private runtime folders such as `data/`, `logs/`, DB files, encrypted files, and tokens.
10. Existing tests are meaningful and should be kept passing.

Previous test status:

```text
62 tests passed
0 failed
```

Previous audit status:

```text
Production npm audit: 0 vulnerabilities
Full npm audit including dev dependencies: Vite/esbuild vulnerabilities found
```

Please rerun tests and audits after any change.

---

# Critical Issues to Address

## H1 — Unsafe ZIP / Packaging Hygiene

### Problem

The previously reviewed ZIP included private/runtime files such as:

```text
myfinance/data/myfinance.db
myfinance/data/backups/*.db
myfinance/data/salt.bin
myfinance/data/sentinel.enc
myfinance/logs/*
docs/INSTRUCTIONS.md
.git/
myfinance/node_modules/
myfinance/client/dist/
```

Even if Git ignores these files correctly, the archive was made from the full working directory and therefore exposed private local data.

### Required Fix

Add a safe packaging mechanism that creates a **code-only archive**.

Preferred options:

1. A script such as:

```text
scripts/make-safe-zip.js
```

or

```text
make-safe-zip.bat
```

2. A documented command such as:

```bash
git archive --format=zip -o MyBudgetManagement-code-only.zip HEAD
```

3. A README section explaining exactly what must never be shared.

### Must Exclude

```text
.git/
myfinance/data/
myfinance/logs/
myfinance/node_modules/
myfinance/client/dist/
docs/INSTRUCTIONS.md
*.db
*.sqlite
*.sqlite3
*.enc
*.bin
*.key
*.pem
*.p12
*.log
.env
.env.*
```

### Acceptance Criteria

- There is a clear documented safe-export process.
- The process cannot accidentally include the local SQLite DB, encrypted credentials, salts, logs, screenshots, or private notes.
- A developer/user can run one command and get a safe ZIP.

---

## H2 — SQLite Financial Data Is Not Encrypted

### Problem

Only bank credentials appear to be encrypted. The SQLite database itself likely stores sensitive financial data in plaintext:

- transactions
- descriptions
- categories
- account/card identifiers
- balances
- raw scraper payloads
- activity logs

If `myfinance.db` leaks, an attacker may not get the bank password, but can read the user's financial history.

### Recommended Fix Options

Please evaluate and propose one of the following:

#### Option A — Practical Minimum

- Document that the app requires full-disk encryption such as BitLocker/FileVault/LUKS.
- Ensure backups are not sent to unencrypted locations.
- Ensure safe ZIP excludes all data files.

#### Option B — Field-Level Encryption

Encrypt sensitive columns, especially:

```text
transactions.description
transactions.raw_payload_json
account_balances
activity_log
account/card identifiers
```

#### Option C — Full SQLite Encryption

Use SQLCipher or another encrypted SQLite-compatible approach.

### Preferred Initial Implementation

Start with **Option A + safe packaging**, then provide a migration plan for Option B or C.

### Acceptance Criteria

- README clearly states the real privacy model.
- Users are not misled into thinking the entire DB is encrypted if only credentials are encrypted.
- Backup and export behavior is documented.

---

## H3 — CORS Is Not Enough; Add CSRF / Same-Origin Action Protection

### Problem

The backend appears to restrict CORS origins, which is good, but CORS mainly prevents reading responses from disallowed origins. It does not reliably prevent another website from attempting state-changing requests against `localhost`.

Potentially sensitive endpoints include:

```text
POST /api/auth/lock
POST /api/scrape/all
POST /api/scrape/account/:id
POST /api/categories/recategorize
POST/PUT/DELETE account/category/budget/transaction endpoints
```

### Required Fix

Add middleware for all state-changing requests:

```text
POST
PUT
PATCH
DELETE
```

The middleware should reject requests unless they pass same-origin/session validation.

Recommended layers:

1. **Origin validation**
   - Allow only known local frontend origins:
     - `http://localhost:3000`
     - `http://127.0.0.1:3000`
     - dev frontend origin if needed, e.g. Vite port.
   - If `Origin` exists and is not allowed, reject with `403`.

2. **Session action token**
   - After successful unlock, backend generates a random session token.
   - Frontend stores it only in React memory.
   - Every mutating request sends:

```text
X-MyFinance-Session: <token>
```

   - Backend rejects mutating requests without a valid token.
   - Token is cleared on lock.
   - Token is rotated on unlock.

3. Optional but recommended:
   - Check `Sec-Fetch-Site` where available.
   - Reject `cross-site` mutating requests.

### Acceptance Criteria

- Cross-origin websites cannot trigger scraper, recategorization, data changes, or lock flows.
- Frontend still works normally.
- Tests cover allowed and rejected origins/tokens.
- No secrets are stored in browser persistent storage.

---

## H4 — WebSocket Origin Check

### Problem

WebSocket server appears to be created without checking request origin.

Browser WebSocket connections can be initiated cross-origin unless the server rejects them.

Currently the WebSocket may only send status/OTP-required events, but future changes could make this more sensitive.

### Required Fix

Add WebSocket connection Origin validation.

Allowed origins should match the HTTP API allowed origins.

### Acceptance Criteria

- WebSocket connections from unknown origins are rejected.
- Local frontend WebSocket still works.
- Add a simple test or documented manual test.

---

## H5 — First-Run / Sentinel Recovery Logic Risk

### Problem

If `sentinel.enc` is missing but the database already contains encrypted credentials, the app may treat the situation as first run and create a new sentinel with a new password.

This can make old encrypted credentials undecryptable.

### Required Fix

When sentinel is missing:

1. Check whether the accounts table contains encrypted credentials.
2. If no credentials exist:
   - allow true first-run initialization.
3. If credentials exist:
   - do not create a new sentinel automatically.
   - enter recovery mode.
   - require the user to enter the old master password.
   - test decryption of at least one stored credential.
   - if successful, recreate sentinel.
   - if unsuccessful, do not modify encryption metadata.

### Acceptance Criteria

- Deleting `sentinel.enc` does not silently break existing credentials.
- Existing credentials remain recoverable if the correct old password is entered.
- Tests cover:
  - real first run
  - missing sentinel + empty DB
  - missing sentinel + existing encrypted credentials + correct password
  - missing sentinel + existing encrypted credentials + wrong password

---

# Medium-Priority Issues

## M1 — PBKDF2 Work Factor Is Too Low

### Problem

Current derivation appears to use approximately:

```js
PBKDF2_ITERATIONS = 100_000
PBKDF2_DIGEST = 'sha512'
```

This is better than plain hashing, but weak for modern offline brute-force resistance.

### Recommended Fix

Prefer Argon2id.

If Argon2id is too disruptive, increase PBKDF2 iterations and add versioned key-derivation metadata.

### Important

Do not simply change the iteration count without migration support, because existing encrypted credentials may become undecryptable.

### Acceptance Criteria

- Key derivation parameters are versioned.
- Existing users can still unlock after migration.
- New encryption uses stronger parameters.
- Wrong password detection still works.
- Tests cover old and new formats if migration is implemented.

---

## M2 — Add Auto-Lock / Session Timeout

### Problem

Once unlocked, the server remains globally unlocked until manually locked or stopped.

### Recommended Fix

Add:

- inactivity timeout, e.g. 10–15 minutes;
- automatic lock after scraping finishes, or at least an option for it;
- re-authentication before high-risk actions:
  - editing bank credentials
  - running scraper
  - exporting data
  - viewing sensitive raw data

### Acceptance Criteria

- The key/session token expires after inactivity.
- Frontend handles expiration gracefully.
- High-risk actions require an active unlocked session.

---

## M3 — Add Password Attempt Rate Limiting

### Problem

`/api/auth/unlock` may allow unlimited guesses.

### Recommended Fix

Add local rate limiting:

- after each wrong password, delay the next attempt;
- exponential backoff;
- optional temporary lockout after repeated failures.

### Acceptance Criteria

- Brute-force attempts are slowed down.
- Correct password still works after a reasonable delay.
- Error messages do not reveal whether sentinel/data state is exploitable.

---

## M4 — CSV Formula Injection

### Problem

CSV export likely quotes values but may not protect against Excel/Sheets formula injection.

If a transaction description starts with:

```text
=
+
-
@
```

spreadsheet apps may treat it as a formula.

### Required Fix

When exporting CSV, prefix risky text fields with a single quote:

```js
function csvSafeText(value) {
  const s = String(value ?? '')
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s
  return `"${safe.replace(/"/g, '""')}"`
}
```

Apply to text fields such as:

```text
description
category
note
source
account name
```

### Acceptance Criteria

- CSV export cannot execute spreadsheet formulas from transaction data.
- Tests cover values starting with `=`, `+`, `-`, and `@`.

---

## M5 — Pending Transaction Deduplication Edge Cases

### Problem

Deduplication appears to rely on:

```text
source + account_number + date + amount + normalized_description + currency
```

This can fail if a pending transaction later becomes completed with a changed date, amount, or description.

### Recommended Fix

Improve matching logic:

1. First match exact dedup key.
2. If no exact match:
   - try to match existing pending rows from the same source/account;
   - use source-specific external transaction IDs if reliable;
   - otherwise use a date window + amount + normalized merchant/description;
   - update pending row to completed instead of inserting duplicate.

### Acceptance Criteria

- Pending-to-completed transactions do not duplicate when minor fields change.
- Tests cover changed date, changed description, and changed pending/completed status.

---

## M6 — Stronger Input Validation

### Problem Areas

Check and harden:

- budget amounts
- transaction pagination
- account IDs
- category IDs
- month strings
- export limits
- date ranges

### Recommended Fix

Add validation helpers or schema validation.

Examples:

```text
amount: finite number >= 0
limit: integer between 1 and 500
page: integer >= 1
month: YYYY-MM
account_id: existing integer ID
```

### Acceptance Criteria

- Invalid values return 400.
- Extremely large limits cannot cause memory/performance problems.
- Tests cover invalid input.

---

## M7 — UTC Month Bug

### Problem

Frontend/backend code may use:

```js
new Date().toISOString().slice(0, 7)
```

This uses UTC and can show the wrong month near local midnight, especially for Israel time.

### Required Fix

Use local time:

```js
function currentMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
```

### Acceptance Criteria

- Current month is based on local system time, not UTC.
- Tests cover month boundary behavior if practical.

---

## M8 — Update Dev Dependencies

### Problem

Previous full npm audit found Vite/esbuild vulnerabilities in dev dependencies.

### Required Fix

- Update Vite/esbuild to safe compatible versions.
- Rerun:
  - `npm audit`
  - production audit
  - test suite
  - build

### Acceptance Criteria

- Production audit remains clean.
- Dev audit has no high-risk issue if possible.
- App still builds and tests pass.

---

# Git and Repository Hygiene

## Add `.gitattributes`

Line-ending changes made many files appear modified. Add:

```text
* text=auto eol=lf
*.bat text eol=crlf
```

Then normalize:

```bash
git add --renormalize .
```

### Acceptance Criteria

- Git diff is stable across Windows/Linux/macOS.
- Future reviews are not polluted by CRLF-only changes.

---

# Suggested Test Additions

Please add tests for:

1. CSRF/session-token middleware:
   - missing token rejected
   - wrong token rejected
   - allowed token accepted
   - disallowed Origin rejected

2. WebSocket Origin:
   - allowed local origin accepted
   - foreign origin rejected

3. Sentinel recovery:
   - first-run empty DB
   - missing sentinel with existing credentials
   - correct password recovery
   - wrong password rejected without changes

4. CSV formula injection:
   - descriptions beginning with `=`, `+`, `-`, `@`

5. Input validation:
   - negative budget amount
   - invalid month
   - huge pagination limit
   - non-integer IDs

6. Dedup:
   - pending transaction finalized with changed date/description
   - external ID-based matching where available

---

# Implementation Rules

Please follow these rules while changing the project:

1. Do not change the product’s core behavior unless necessary for security.
2. Do not log decrypted credentials or financial records.
3. Do not add browser persistent storage for secrets.
4. Keep backend bound to `127.0.0.1`.
5. Keep all existing tests passing.
6. Add tests for every security-sensitive change.
7. Keep changes small and reviewable.
8. Prefer explicit error handling over silent fallback.
9. Document any migration requirement.
10. Do not include private runtime files in commits or generated archives.

---

# Expected Deliverables

Please provide:

1. A short summary of verified findings.
2. A patch or list of changed files.
3. Explanation of each security change.
4. Migration notes, if any.
5. Commands to run:

```bash
npm install
npm test
npm audit
npm run build
```

Adjust commands to the actual package scripts if different.

6. A final checklist:

```text
[ ] Safe ZIP excludes private files
[ ] API mutating requests require session token
[ ] Cross-origin mutating requests rejected
[ ] WebSocket origin checked
[ ] Sentinel recovery safe
[ ] CSV export protected
[ ] Input validation improved
[ ] Tests pass
[ ] Production audit clean
[ ] Dev vulnerabilities addressed or documented
```

---

# Priority Order

Please handle in this order:

1. Safe ZIP / packaging hygiene
2. CSRF/session-token middleware for mutating API calls
3. WebSocket Origin validation
4. First-run sentinel recovery protection
5. CSV formula injection fix
6. Input validation hardening
7. Auto-lock/session timeout
8. PBKDF2/Argon2id migration plan
9. Deduplication improvements
10. Dev dependency updates
11. `.gitattributes` normalization

---

# Final Note

The project already has a reasonable foundation for a local-first personal finance tool. The highest risks are not obvious hardcoded secrets, but rather:

1. accidental sharing of private runtime files;
2. plaintext financial data in SQLite;
3. localhost API actions that rely too much on CORS;
4. fragile encryption recovery flow.

Please focus on making the local threat model explicit and preventing accidental data exposure.
