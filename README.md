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

See `docs/DEVELOPMENT_GUIDE.md` for architecture and how to run/test locally.