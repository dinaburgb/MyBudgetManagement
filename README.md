# MyBudgetManagement

A local personal finance dashboard for tracking income, expenses, and budgets — with automatic transaction import from Israeli banks and credit cards.

All data stays on your machine. No cloud sync, no subscriptions, no accounts.

![Dashboard](docs/screenshots/dashboard.png)

---

## Features

- **Automatic bank scraping** — imports transactions from Bank Discount, Hapoalim, FIBI (Beinleumi), Visa Cal, Isracard, Max, Mizrahi Tefahot, and OneZero (see [Bank Support](#bank-support))
- **Budget tracking** — set monthly budgets per category with carryover support and visual donut tiles
- **Auto-categorization** — 108 built-in keyword rules classify transactions automatically; edit and add your own
- **Multi-owner support** — track spending per family member with per-account owner assignment
- **Assets tracking** — track savings accounts, investments, real estate, and other assets alongside bank accounts
- **Manual entry** — add transactions that don't come from a bank
- **Transfer detection** — automatically identifies and pairs internal transfers between your accounts
- **Period comparison** — compare spending across any two custom periods (single months, several months, or whole years) with a month-by-month matrix, per-category averages, and income/expense/net totals; click any category to see the transactions behind it
- **Encrypted credentials** — bank usernames/passwords are encrypted at rest with AES-256-GCM; the master password is never stored
- **OTP / SMS support** — enter one-time codes directly in the browser when your bank requires 2FA
- **Full offline** — runs as a local Node.js server; no internet required after install (except for bank scraping)

---

## Bank Support

| Bank / Card         | Status          | Notes                                                      |
|---------------------|-----------------|------------------------------------------------------------|
| Bank Discount       | ✅ Working       | Patched for the new site layout                            |
| Bank Hapoalim       | ✅ Working       | Manual SMS/OTP in a visible browser window                 |
| FIBI (Beinleumi)    | ✅ Working       | Deduplication by content hash                              |
| Visa Cal            | ✅ Working       | Multi-card support                                         |
| Mizrahi Tefahot     | ⚙️ Configured   | Wired up, not yet tested end-to-end                        |
| Isracard            | ⚙️ Configured   | Wired up, not yet tested end-to-end                        |
| Max                 | ⚙️ Configured   | Wired up, not yet tested end-to-end                        |
| OneZero             | 🚫 Blocked      | Cloudflare blocks Node's TLS fingerprint; needs workaround |

Powered by [israeli-bank-scrapers](https://github.com/eshaham/israeli-bank-scrapers).

---

## Requirements

- **Windows 10/11** (the `.bat` launchers are Windows-only; the Node server itself runs on any OS)
- **Node.js 18+** — [nodejs.org](https://nodejs.org)
- **Google Chrome** — used by the scraper (Puppeteer controls it headlessly)

---

## Installation

### Option A — Automatic (Windows)

1. Download or clone this repository.
2. Double-click **`myfinance/installation.bat`**.
   - It runs `npm install` inside `myfinance/`, which also installs Puppeteer and downloads a compatible Chrome build.
3. That's it. You're ready to start.

### Option B — Manual

```bash
cd myfinance
npm install
```

---

## Running the App

Double-click **`myfinance/start.bat`** (or `MyBudget.bat` in the root).

This starts the Node server and opens the dashboard in your default browser at `http://localhost:3000`.

**First run:** you will be prompted to set a master password. This password encrypts your bank credentials. It is never stored — you must enter it each time you open the app.

---

## First-Time Setup

1. **Set master password** on the lock screen.
2. Go to **Accounts** → **Add account** for each bank/card you want to track.
   - Enter the institution (e.g. `discount`, `hapoalim`, `cal`), your username, and password.
   - Credentials are encrypted immediately and stored in `data/credentials.enc`.
3. Go to **Accounts** → click **Sync** to import transactions for the first time.
   - For banks that require SMS/OTP: a browser window will open — enter the code when prompted.
4. Go to **Categories** to review and adjust the auto-assigned categories.
5. Go to **Budgets** to set monthly spending limits per category.

---

## Usage Guide

### Dashboard

The main screen shows:
- **Budget tiles** — each category as a donut with spent vs. budget; color turns red when over budget.
- **Monthly summary** — total income, expenses, and net for the current month.
- **Recent transactions** — the last 20 transactions across all accounts.

### Transactions

- Filter by date range, owner, category, or account.
- Click a category cell to re-assign the category; optionally turn it into a permanent rule.
- Add notes to individual transactions.
- Manually add a transaction with the **+ Add** button.

### Accounts

- Add, edit, or remove bank/card connections.
- Toggle **Include in totals** to exclude an account from budget and overview calculations (useful for investment accounts).
- **Sync** button triggers a fresh scrape for that account.

### Assets

Track non-bank assets (real estate, savings plans, investments). Enter current value manually; history is kept automatically.

### Budgets

- Set a monthly budget per category.
- Enable **carryover** to roll unused budget into the next month.
- Mark a category as **income** to flip it in the net calculation.

### Categories

- Edit auto-categorization rules (keyword → category mappings).
- **Re-categorize all** applies updated rules to your entire transaction history.

### Compare

Compare two periods side by side. Each period (A and B) is a free selection of
months — pick months one by one, or use the quick buttons: **All**, **Clear**,
or a specific **year** to select all of its months at once. Quick presets
(month-vs-previous, two-vs-two, three-vs-three) are also available.

The page shows:

- **Monthly matrix** (top) — categories as rows, every selected month as a
  column. Month headers are colour-coded: blue for period A, grey for period B,
  purple when a month belongs to both. Click any category row to expand the
  underlying transactions inline.
- **Summary column** (far left) — per-category **average per month** in the data
  rows, and the **grand total** in the footer rows.
- **Footer totals** — three rows per month: total **expenses**, total
  **income**, and **net** (income − expenses), each also totalled in the
  summary column.
- **Period totals + chart** (below) — total spend for period A vs B with the
  change and percentage, a grouped bar chart of the top categories, and a
  per-category comparison table.

Income and excluded categories (e.g. credit-card repayments, internal
transfers) are kept out of the expense rows so the totals reflect real spending.

---

## Security Model

| What                    | How it's stored                                              |
|-------------------------|--------------------------------------------------------------|
| Master password         | Never stored — derived key held in memory for the session only |
| Bank credentials        | AES-256-GCM encrypted in `data/credentials.enc`             |
| Transactions / budgets  | Plaintext in `data/myfinance.db` (SQLite)                    |
| OTP / SMS codes         | Entered in browser, never stored                             |
| Anything in Git         | No credentials, no DB, no secrets — see `.gitignore`         |

**Important:** the SQLite database (`data/myfinance.db`) contains your full transaction history in plaintext. Protect it with:
- Full-disk encryption (BitLocker / FileVault / LUKS)
- Encrypted backups — do not sync `data/` to an unencrypted cloud

The app auto-backs up the database to `data/backups/` before each import.

Cross-origin requests are blocked: only `localhost` can talk to the server, so a website you have open in another tab cannot drive the app.

---

## Folder Structure

```
myfinance/
├── client/          # React frontend (Vite)
│   └── src/
│       └── pages/   # Dashboard, Transactions, Accounts, Budgets, …
├── server/
│   ├── db/          # SQLite schema, queries, categorization engine
│   ├── routes/      # Express API routes
│   ├── scrapers/    # Bank scraper wrapper (Puppeteer / israeli-bank-scrapers)
│   └── crypto/      # AES-256-GCM encryption helpers
├── tests/           # Node test files (run with `npm test`)
├── data/            # Runtime data — git-ignored (DB, credentials, backups)
└── logs/            # Runtime logs — git-ignored
```

---

## Running Tests

```bash
cd myfinance
npm test
```

All tests use an in-memory SQLite database — no real credentials or network needed.

---

## Exporting Code Without Personal Data

To share or archive the code without any personal data:

```bash
git archive --format=zip -o MyBudgetManagement-code-only.zip HEAD
```

This includes only tracked files — never `data/`, `logs/`, the database, or secrets.

---

## Disclaimer

This software is provided **as-is**, without warranty of any kind. It is a personal tool, not a financial product. It is not affiliated with any bank or financial institution. Use at your own risk. Always verify important figures against your official bank statements.

---

## License

MIT
