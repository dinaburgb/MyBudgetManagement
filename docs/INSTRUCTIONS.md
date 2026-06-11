# MyFinance Dashboard — Instructions for Claude Code

## Who I am
I am a 50-year-old financial consultant and algorithmic trading company owner living in Israel. I have no software development experience. I need you to write all the code, explain what you are doing in simple terms, and never assume I know technical concepts. When something requires my input (like entering an OTP code or testing a bank connection), tell me exactly what to do step by step.

## What we are building
A local web application that runs on my Windows computer. It connects to all my Israeli bank accounts and credit cards, downloads transactions, and displays everything in a single private dashboard. No cloud. No subscriptions. Everything stays on my computer.

## My accounts

### Banks:
- Bank Hapoalim
- Bank Discount
- FIBI (Beinleumi)
- Mizrahi Tefahot
- OneZero (experimental — lower priority)

### Credit cards:
- Isracard
- Visa Cal
- Max
- Mastercards (issued through Cal or Max)
- Some cards belong to my wife Irena, some to me (Boris)

## Core technical decisions already made
- Runtime: Node.js v22+
- Database: SQLite via better-sqlite3
- Backend: Express.js (monolith — backend serves frontend too)
- Frontend: React + Vite + Tailwind CSS + Lucide React
- Charts: Recharts only (not Chart.js)
- Bank scraping: israeli-bank-scrapers library
- Encryption: Node.js Crypto API — AES-256-GCM + PBKDF2
- OTP handling: WebSocket — popup appears in browser when bank requires SMS code
- Launcher: Single .bat file on Windows desktop

## Architecture
Single monolithic application. One Node.js process. Express serves both the API and the compiled React frontend. SQLite is a single file on disk. No Docker. No microservices. No cloud.

## How it launches
User double-clicks a `.bat` file on the desktop. Node.js server starts. Browser opens automatically at `localhost:3000`. User enters master password. Application is ready.

## Security rules — strictly follow these
- Bank credentials encrypted with AES-256-GCM using a key derived from master password via PBKDF2
- Master password is NEVER saved anywhere on disk
- Decrypted credentials exist only in memory during scraping session
- Raw credentials never logged or written to any file
- SQLite database stored in user's home directory
- Automatic database backup before every import
- Audit log exists but contains NO sensitive data

## Database schema rules
Every transaction must store these fields:
- id (internal)
- external_id (from bank, if available)
- dedup_key (hash for deduplication)
- raw_payload_json (original data from scraper — never delete this)
- date
- processed_date
- amount
- original_amount
- original_currency (ILS / USD / EUR)
- charged_amount
- charged_currency
- description
- memo
- category
- owner (Boris / Irena / Joint)
- account_number
- account_name
- source (hapoalim / discount / fibi / mizrahi / onezero / isracard / cal / max)
- card_last4
- type (normal / installment)
- installment_number
- installment_total
- status (completed / pending)
- created_at
- updated_at

## Deduplication rules
- Use external_id from bank when available and stable
- Otherwise use: `hash(source + account_number + date + amount + normalized_description + currency)`
- Normalize description before hashing: lowercase, trim spaces, remove special characters
- Store raw_payload_json always — never discard original data
- Handle pending → completed transitions: update existing record, do not create duplicate
- Use `INSERT OR IGNORE` or `ON CONFLICT DO UPDATE` in SQLite

## Scraping rules
- First run: fetch last 6 months
- Subsequent runs: fetch last 45 days with 14-day overlap for reliability
- Always show "last successful update" timestamp per account
- If scraping fails for one account, continue with others — do not stop everything
- If bank requires OTP: pause that account, show WebSocket popup in browser, wait for user input, then continue
- Never store OTP codes
- OneZero requires special handling: long-term token after first OTP — implement this properly

## Development sequence — follow this exact order
Do not skip ahead. Complete each phase fully before starting the next.

### Phase 1 — Foundation (most critical)
1. Initialize Node.js project with correct folder structure
2. Set up Express server
3. Set up React + Vite frontend
4. Set up SQLite database with full schema
5. Implement master password + AES-256-GCM encryption module
6. Test that encryption works correctly
7. Build credentials management UI (add/edit/delete bank credentials)

Phase 1 is done when: I can launch the app, enter master password, add credentials for one bank, and see them saved (encrypted) and retrieved correctly.

### Phase 2 — First scrape
1. Integrate israeli-bank-scrapers
2. Connect Hapoalim first
3. Implement deduplication logic
4. Save raw_payload_json for every transaction
5. Build basic transaction table in UI (just a table, no styling yet)
6. Test full cycle: scrape → deduplicate → save → display

Phase 2 is done when: I press "Update" for Hapoalim, transactions download, save to SQLite without duplicates, and appear in a table in the browser.

### Phase 3 — OTP and all accounts
1. Implement WebSocket OTP mechanism
2. Test OTP flow with at least one bank that requires it
3. Add all remaining banks: Discount, FIBI, Mizrahi
4. Add all cards: Isracard, Cal, Max
5. Add OneZero with long-term token handling
6. Test all accounts end to end

Phase 3 is done when: All accounts update successfully, OTP popup works, no duplicates across accounts.

### Phase 4 — Organization
1. Owner tagging system (Boris / Irena / Joint) — map each account/card to owner
2. Full transaction table with filters: by owner, bank, card, date range, amount range, category
3. Search by description
4. CSV export
5. Pagination for large datasets

Phase 4 is done when: I can filter transactions by owner and export to CSV.

### Phase 5 — Categorization
1. Category table in SQLite
2. Rule engine: IF description CONTAINS "X" THEN category = "Y"
3. Rules management UI (add/edit/delete rules)
4. Apply rules to existing transactions
5. Manual category override on any transaction
6. Default categories: Groceries, Restaurants, Transport, Fuel, Healthcare, Utilities, Communications, Shopping, Entertainment, Education, Travel, ATM, Transfers, Other

Phase 5 is done when: 80%+ of regular transactions are auto-categorized correctly.

### Phase 6 — Dashboard
1. Total balance across all accounts
2. Monthly spending total
3. Month-over-month comparison
4. Spending by category (pie chart — Recharts)
5. Monthly income vs expenses (bar chart — Recharts)
6. Free money remaining this month
7. Weekly spending limit and progress bar
8. Last update timestamp per account

Phase 6 is done when: Main dashboard shows accurate financial picture for current month.

### Phase 7 — Polish and reliability
1. Error handling for all scraping failures
2. Clear error messages in UI (not technical errors — human language)
3. Automatic SQLite backup before each import (keep last 7 backups)
4. Activity log (no sensitive data)
5. "Retry failed account" button
6. Loading states and progress indicators during scraping
7. Final .bat launcher that opens browser automatically
8. README file with setup instructions

Phase 7 is done when: Application runs reliably, errors are handled gracefully, one-click launch works.

## Folder structure to create
```
myfinance/
├── server/
│   ├── index.js
│   ├── db/
│   │   ├── schema.js
│   │   └── database.js
│   ├── scrapers/
│   │   └── scraper.js
│   ├── crypto/
│   │   └── encryption.js
│   └── routes/
│       ├── transactions.js
│       ├── accounts.js
│       └── scrape.js
├── client/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── components/
│   │   └── pages/
│   └── index.html
├── data/
│   ├── myfinance.db
│   ├── credentials.enc
│   └── backups/
├── logs/
├── package.json
├── vite.config.js
├── .gitignore
└── start.bat
```

## What to always do
- After completing each phase, summarize what was built and confirm it works before moving on
- If something does not work as expected, fix it before proceeding
- Write comments in code explaining what each part does — I need to understand it
- When you need me to test something, give me exact instructions: what to click, what to type, what I should see
- If a bank scraper breaks due to a website change, explain clearly what happened and what needs to be updated
- Keep all user-facing text in English (I understand English, Hebrew, and Russian)

## What to never do
- Never store master password anywhere
- Never log bank credentials or OTP codes
- Never skip deduplication
- Never delete raw_payload_json
- Never add features from a later phase before the current phase is complete
- Never use localStorage or sessionStorage in the browser
- Never connect to any external API except the bank websites themselves
