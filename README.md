# MyBudgetManagement

Local personal finance dashboard for private family budget management.

## Current status

Project setup stage.

## Main principles

- Local only
- No cloud sync
- No real bank credentials in Git
- SQLite local database
- Manual update flow

## Security

- The master password is never stored. A 256-bit key is derived from it (PBKDF2)
  and held only in memory for the session.
- Bank credentials are encrypted at rest (AES-256-GCM) under `data/` (git-ignored).
- Decrypted credentials live only in memory during a scrape — never logged, never
  written to disk, never returned over HTTP.
- OTP/SMS codes are entered by the user in the browser and are never stored.
- The browser never uses `localStorage`/`sessionStorage`.
- `data/` and `logs/` are git-ignored. **Never commit** databases, `*.enc`/`*.bin`
  files, logs, or the failure screenshots that may appear in `logs/`.
- State-changing API calls (`POST/PUT/DELETE`) are rejected from cross-site
  origins, and the WebSocket rejects unknown origins — so a random website you
  have open can't drive the local app.

## Privacy model — read this

**Only bank/card credentials are encrypted.** The rest of the SQLite database —
your transactions, descriptions, categories, budgets, balances and raw scraper
payloads — is stored **in plaintext** in `data/myfinance.db`. If that file leaks,
someone can read your financial history (but not your bank passwords).

Therefore:

- **Rely on full-disk encryption** (BitLocker / FileVault / LUKS) on the machine
  that runs this app. That is the real protection for the data file.
- **Keep backups encrypted.** The app auto-backs up to `data/backups/` before each
  import — that folder is just as sensitive as the DB. Don't sync it to an
  unencrypted cloud location.
- **Never share the working folder as-is.** It contains `data/` and `logs/`.

### Safe code-only export

To share or archive the code **without** any private data, export straight from
git (this includes only tracked files — never `data/`, `logs/`, DB or secrets):

```bash
git archive --format=zip -o MyBudgetManagement-code-only.zip HEAD
```

Do **not** zip the working directory directly — that would sweep in `data/`,
`logs/`, `node_modules/` and `client/dist/`.

See `docs/DEVELOPMENT_GUIDE.md` for architecture and how to run/test locally.