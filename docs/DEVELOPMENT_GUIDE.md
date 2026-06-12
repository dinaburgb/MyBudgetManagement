# MyBudgetManagement — Development Guide

A local, single-user personal finance dashboard. Everything runs and stays on the
local machine. No cloud, no telemetry, no third-party APIs except the bank/card
websites the scrapers visit.

## Architecture

- **Runtime:** Node.js (uses the built-in `node:sqlite`, no native build step).
- **Backend:** Express, serves both the API and the compiled React frontend.
- **Frontend:** React + Vite + Tailwind CSS + Recharts + Lucide icons.
- **Database:** single local SQLite file under `data/` (git-ignored).
- **Scraping:** `israeli-bank-scrapers` driven by Puppeteer (headful so the user can
  complete SMS/OTP challenges manually in the window).

```
myfinance/
  server/    Express app, crypto, db, routes, scrapers
  client/    React app (src/pages, src/components)
  data/      SQLite db + salt + sentinel  (git-ignored)
  logs/      runtime logs + failure screenshots  (git-ignored)
  patches/   patch-package patches for israeli-bank-scrapers
  tests/     local tests using fake data only
```

## Security model

- The master password is **never** stored. A 256-bit key is derived from it with
  PBKDF2 and kept only in memory for the session.
- Bank credentials are encrypted at rest with AES-256-GCM (`server/crypto/encryption.js`)
  and live under the git-ignored `data/` folder.
- Decrypted credentials exist only in memory during a scrape and are never logged,
  never written to disk, and never returned over HTTP.
- OTP/SMS codes are entered by the user in the browser and are never stored or logged.
- The browser never uses `localStorage`/`sessionStorage`.

## Running locally

```
cd myfinance
npm install          # also re-applies patches via postinstall
npm run build        # build the React client
npm start            # start the server on http://localhost:3000
```

On Windows you can also double-click `myfinance/start.bat`.

## Tests (safe — no bank access, no real credentials)

```
cd myfinance
node tests/test_save_transactions.js
node tests/test_encryption.js
```

## Adding a bank

1. Confirm the source is supported by `israeli-bank-scrapers` and add it to the
   `SOURCE_TO_COMPANY` map and the credential-field list in the UI.
2. Test with a real account locally; if login fails, capture the failure screenshot
   from `logs/` (git-ignored) and adjust.
3. If you must patch the library, edit it under `node_modules`, then run
   `npx patch-package israeli-bank-scrapers` and commit the updated patch.

## Maintenance

Check weekly for `israeli-bank-scrapers` updates and bank-site changes; bank UIs
change and silently break scrapers. After upgrading the library, re-verify the
patches still apply.
