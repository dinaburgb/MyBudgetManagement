# MyBudgetManagement - Project Plan

## Goal
Build a local budget management application to help users track income, expenses, and financial goals with an intuitive interface and reporting capabilities.

## Scope
- User-friendly dashboard for viewing budget overview
- Expense and income tracking with categories
- Budget allocation and monitoring
- Basic reporting and analytics
- Local data storage
- Automatic transaction import from Israeli banks & credit cards (via israeli-bank-scrapers)

## Out of scope
- Cloud synchronization
- Multi-user collaboration
- Mobile application

## Connected sources
Status of each bank / card integration:

| Source            | Key        | Status        | Notes                                            |
|-------------------|------------|---------------|--------------------------------------------------|
| Bank Discount     | discount   | ✅ Working     | First source implemented; patched for new site   |
| Bank Hapoalim     | hapoalim   | ✅ Working     | Manual SMS/OTP in visible browser                |
| FIBI (Beinleumi)  | fibi       | ✅ Working     | Dedup by content (reuses reference per payee)    |
| Visa Cal          | cal        | ✅ Connected   | Connected 2026-06-12 — 87 transactions imported  |
| Mizrahi Tefahot   | mizrahi    | ⚙️ Wired       | Configured, not yet tested with real account     |
| OneZero           | onezero    | 🚫 CF-blocked  | SMS-link flow built, but Cloudflare blocks Node's TLS fingerprint (403/HTML) for all OneZero calls; curl from the same machine passes. Needs a curl-backed transport or CSV import. Deferred. |
| Isracard          | isracard   | ✅ Connected   | Connected (user-confirmed 2026-06-17), importing  |
| Max               | max        | ✅ Connected   | Connected (user-confirmed 2026-06-17), importing  |

## Current status
- Phase 1 (foundation: auth, DB, accounts, transactions UI) — done
- Phase 2 (scraping, deduplication, save to DB) — done
- Security review + CORS lockdown to localhost only — done
- **Visa Cal connected (2026-06-12):** first sync imported transactions successfully
  (multiple cards under the same login were tested).
- **Expense categories (2026-06-12):** keyword-rule auto-categorization engine
  (`server/db/categorize.js`), Categories management page (rules + re-categorize +
  per-category summary), category filter on the Transactions page, and category
  applied automatically on import. 108 default rules seeded on first run.
- **Hebrew categories + account exclusion (2026-06-12):**
  - All categories are now a single canonical Hebrew set (`CATEGORIES_HE`).
    `normalizeCategory` folds both the old English names and the scrapers' own
    Hebrew taxonomy (esp. Visa Cal) into it; `migrateCategoriesToHebrew` converted
    all existing data on startup (440 values normalized).
  - Accounts have an `include_in_totals` flag (toggle on the Accounts page).
    Excluded accounts are left out of the category summary.
  - Transactions page gained an account filter and an "only accounts in totals"
    checkbox (API: `account_id`, `exclude_account_id`, `only_in_totals`).
  - Covered by tests in `tests/test_categorize.js` (13 tests). Full suite: 27 tests.

- **Full Hebrew UI + budgets + charts (2026-06-12):**
  - Whole interface translated to Hebrew and switched to RTL (`<html lang="he" dir="rtl">`).
    All pages (lock screen, accounts, transactions, categories) plus nav are Hebrew.
  - Monthly budget limits per category: `budgets` table (recurring default with
    optional per-month override), `server/db/budgets.js` + `routes/budgets.js`,
    and a Budgets page with progress bars (green/amber/red), month picker, and a
    "this month only" toggle. Spent counts only included accounts.
  - Dashboard "Overview" page with recharts: monthly income-vs-expense bar chart,
    expenses-by-category donut, and KPI cards. Backed by `routes/stats.js`.
  - Tests: `tests/test_budgets.js` (8 tests). Full suite: 35 passing.

- **Flexible Overview + account balances (2026-06-12):**
  - Overview period selection is now flexible: quick ranges (3/6/12/this year),
    a from→to range picker, and arbitrary month chips (multi-select set).
  - Account selection on the Overview is per-view (checkboxes), independent of the
    persistent include_in_totals flag.
  - Scrape and store the balance "as of update day" per account/card
    (`account_balances` table, `server/db/balances.js`). Banks return a real
    balance; cards store null. Shown per account on the Accounts page and as a
    "current net balance" KPI on the Overview.
  - `routes/stats.js` now accepts a months set and an accounts set, and returns
    netBalance. Tests: `tests/test_balances.js` (3). Full suite: 38 passing.
  - NOTE: balances populate on the NEXT sync of each account (re-run "עדכון").
- **Clean account (2026-06-12):** deleting an account now offers two choices
  (`server/db/accounts.js` `deleteAccount`): "remove account only" detaches its
  transactions (account_id → NULL, kept as history, dropped from totals) and
  removes its balances; "clean all" deletes the account, its transactions and
  balances so nothing appears anywhere. UI: inline confirm with a transaction
  count. Tests: `tests/test_accounts.js` (3). Full suite: 41 passing.
- **Transaction notes (2026-06-12):** every transaction now has an optional
  user note (`transactions.note` column, added by migration). Editable inline
  from two places via a shared `client/src/NoteEditor.jsx`: the Transactions
  table (new "הערה" column) and the Overview pie drill-down list. Saved through
  `PUT /api/transactions/:id/note`; also included in the CSV export. Category
  rename was already available on the Categories page (pencil icon), and it
  propagates to transactions, rules and budgets.
- **Authoritative rules + budget drill-down (2026-06-13):**
  - Categorization precedence fixed: a keyword rule with priority >=
    `AUTHORITATIVE_PRIORITY` (100) now overrides even the scraper's own category,
    on import and on re-apply. Normal rules still only fill in when the scraper
    gave nothing. New helpers in `categorize.js`: `matchRule`, `ensureEssentialRules`
    (idempotent: seeds/upgrades the curated `ESSENTIAL_RULES` to authoritative and
    applies each once), wired into startup in `index.js`. `save-transactions.js`
    uses `pickCategory`. The UI "apply to already-categorized" checkbox now also
    makes the rule authoritative so it sticks for future imports.
  - Curated essential rules grounded in the real data: רב קו → ילדים; and
    דלק/מוסך/פנגו/סלופארק/משרד התחבורה/רשיונות/רישוי/קנס → רכב. First run moved
    25 existing transactions.
  - Budgets page: clicking a category's spent figure expands its transactions for
    that month inline (`GET /api/budgets/transactions`, `budgetCategoryTransactions`
    in `db/budgets.js`), with the same inline note editor.
  - Tests: `tests/test_categorize.js` now 20. Full suite: 7 files passing.
  - PENDING: mortgage (משכנתא) — Mizrahi not synced yet (0 matching rows) and the
    target category isn't decided, so it's deferred.
- **Internal-transfer detection (2026-06-14):**
  - `transactions.is_transfer` flag (migration). A flagged transaction is ignored
    in every total (stats monthly/pie/income/drill, budgets spent + drill +
    suggestions, categories summary).
  - `db/transfers.js`: `findTransferCandidates` suggests pairs (opposite sign,
    equal magnitude, different INCLUDED accounts, within ±5 days, neither already
    a transfer, not previously dismissed; greedy nearest-date dedupe).
    `markTransferPair` / `unmarkTransfer` / `ignoreTransferPair`
    (+ `ignored_transfer_pairs` table). Routes under `/api/transfers`.
  - Nothing is removed without confirmation: `TransfersReview.jsx` banner on the
    Transactions page lists suggested pairs with "סמן כהעברה" / "לא העברה"; flagged
    rows show an "העברה פנימית" badge with an undo ✕.
  - NOTE: only catches true A↔B transfers where BOTH legs are tracked. One-legged
    moves (money from an untracked account, salary, CC repayment) don't pair — use
    the income / excluded category flags for those.
  - Tests: `test_transfers.js` (6). Full suite: 11 files passing.
- **Excluded categories, Overview totals, budget suggestions (2026-06-13):**
  - `categories.is_excluded` flag (migration auto-marks 'הורדת כרטיס אשראי') —
    such a category is ignored EVERYWHERE in totals: monthly KPIs, expense pie,
    budget-vs-actual table, Budgets page, and the Categories summary. Reason: a
    credit-card repayment debit isn't a real expense (the card's own charges are
    already itemized). Toggle per category on the Categories page; helper
    `excludedCategoryNames`.
  - Overview totals: a "סה"כ הוצאות" line under the expense pie, and a totals
    footer (תקציב / ביצוע / נותר over expense rows) on the budget table.
  - Budgets page: per-category suggestion from the last 6 complete months
    (`GET /api/budgets/suggestions`, `budgetSuggestions` averages spend / 6,
    rounded to 10, skipping income/excluded categories) — a "הצע לפי 6 חודשים"
    button fills the input.
  - Tests: +2 budgets (exclusion + suggestions), +1 categories_store (is_excluded).
    Full suite: 10 files passing.
- **Graceful shutdown (2026-06-13):** `POST /api/app/shutdown` clears the key,
  closes WS + HTTP server + DB and exits(0); a "סגירת התוכנה" button on the
  dashboard with an end screen. Behind the same-origin guard.
- **Security hardening + manual entry + prefix search (2026-06-13):**
  - H5 — safe unlock: `unlockOrInit` never re-initialises while encrypted
    credentials exist; a lost sentinel is only recreated if the entered password
    actually decrypts a stored credential, else it's a wrong password (no metadata
    touched). Crypto data dir is overridable via `MYFINANCE_CRYPTO_DIR` for tests.
  - H3/H4 — a lightweight same-origin guard rejects cross-site `POST/PUT/PATCH/DELETE`
    (Origin + Sec-Fetch-Site), and the WebSocket rejects unknown origins. No tokens.
  - M4 — CSV export neutralises formula injection (`server/util/csv.js`, `csvSafeText`).
  - M7 — budgets `currentMonth()` uses local time, not UTC.
  - M6 — input validation: transactions pagination capped (limit 1..500, page>=1);
    budget amount must be finite and non-negative.
  - Manual entry: `POST /api/transactions` + `insertManualTransaction` (source
    'manual', random dedup key) for cash etc.; `ManualTxnForm.jsx` on the
    Transactions page (date/desc/amount/expense-income/category/owner/account).
  - Transactions search is now a prefix match (`description LIKE 'term%'`, wildcards
    escaped).
  - `.gitattributes` (eol=lf) to stop CRLF-only diffs; README privacy model +
    `git archive` safe-export; untracked the external review brief.
  - Tests: `test_auth.js` (3, H5), `test_csv.js` (5), +3 manual-entry in
    test_save_transactions. Full suite: 10 files passing.
- **Multi-filters, master-password change/reset, disclaimer (2026-06-13):**
  - Transactions filters for owner / category / account are now multi-select
    (`client/src/MultiSelect.jsx`); the owners list is derived from the accounts
    (no hardcoded owner names). Server `/api/transactions` accepts
    comma-separated `owner`, `category`, `account_id` (built as `IN (...)`).
  - Master (app) password: `POST /api/auth/change-password` re-encrypts all stored
    bank credentials under the new key (`changeMasterPassword`); `POST /api/auth/reset`
    is the "forgot password" path — wipes salt+sentinel and the unrecoverable
    encrypted credentials but KEEPS all financial data (`resetMasterPassword`).
    `/api/auth/status` now also returns `passwordSet`. Both flows are on the lock
    screen (change / "שכחתי סיסמה").
  - Disclaimer: full "as-is, no warranty, use at own risk, not financial advice"
    text on the lock screen with a required acceptance checkbox (gates entry); a
    short version (`DISCLAIMER_SHORT` in `client/src/legal.js`) in a footer on every
    tab.
- **Apply-rule prompt + income categories (2026-06-13):**
  - After a category is changed from any transaction list (Transactions table,
    Overview/Budgets drill-downs), a prompt offers to turn it into an authoritative
    rule for all similar transactions. Shared `client/src/ApplyRulePrompt.jsx`; the
    keyword is pre-filled from the description but editable. Posts a rule with
    `applyMode: 'all'`.
  - Income categories: new `categories.is_income` flag (migration auto-marks an
    existing 'הכנסות'). Income categories are kept OUT of the expense pie and get a
    row in the Overview "תקציב מול ביצוע" table whose "actual" is their income sum
    (not expenses), tagged "הכנסה". `incomeCategoryNames` in `db/categories.js`;
    stats `buildBudgetTable` now takes expense + income maps + the income set.
    Toggle per category on the Categories page (edit mode).
  - Tests: +1 categories_store (is_income). Full suite: 8 files passing.
- **Per-account-number inclusion (2026-06-13):**
  - One bank login can expose several account numbers (Discount returns 3). Added
    `excluded_subaccounts (account_id, account_number)` — presence = excluded from
    totals; absence = included (default). The login-level `include_in_totals` still
    applies on top.
  - `db/subaccounts.js`: `notExcludedSql(idCol, numberCol)` SQL fragment,
    `listSubAccounts`, `setSubAccountIncluded`, `hasExcludedSubAccounts`. The
    fragment is now applied in every "totals" query: stats overview (monthly,
    byCategory, drill), budgets (spent + drill), categories summary, transactions
    `only_in_totals`, and `netBalance`.
  - Routes: `GET /api/accounts/:id/subaccounts`, `PUT /api/accounts/:id/subaccounts`
    ({account_number, include}). Accounts list now returns `subaccount_count` and
    `excluded_count`.
  - Accounts page: logins with >1 number show an expandable "פירוט חשבונות" panel
    with a per-number include checkbox, txn count and balance.
  - Tests: `tests/test_subaccounts.js` (4). Full suite: 8 files passing.
- **Edit-category everywhere + Overview budget table (2026-06-13):**
  - New shared `client/src/TxnRow.jsx`: one compact transaction row (date,
    description, inline category select, inline note, amount). Used in the Overview
    and Budgets drill-downs so a charge can be re-filed from anywhere it's shown;
    `onChanged` refreshes the parent totals. Replaced the old wide rows (narrower
    drill panels, `max-w-2xl`).
  - Delete-category now takes a destination: `deleteCategory(db, id, target)` moves
    its data to `target` (default 'אחר'); route is `DELETE /api/categories/:id?target=`.
    UI shows an inline destination picker instead of a blind confirm.
  - Overview "תקציב מול ביצוע" table: category / budget / actual / remaining over
    the selected months. Budget is the effective limit summed across months
    (`budgetSummaryForMonths` in `db/budgets.js`), null → empty cell; actual reuses
    the tab's selected-accounts expenses. Returned as `budgetTable` from
    `GET /api/stats/overview`.
  - Tests: +2 in test_categories_store, +1 in test_budgets. Full suite green.
  - NOTE on bi-monthly bills (water/ארנונה/gas): budgets are monthly, so set the
    monthly-equivalent (half the bi-monthly charge) and compare over a 2-month
    range in the Overview table, where the lumpiness averages out.

- **Financial-assets balance sheet (2026-06-14):**
  - New "נכסים" tab — a manual balance sheet for holdings at pension/insurance/
    investment providers (כלל, הראל, מיטב, מור, אקסלנס, פסגות, אינטראקטיב ברוקרס).
    Phase 1 is manual entry; automatic pulls (Interactive Brokers etc.) are a
    later phase. המסלקה הפנסיונית is explicitly out of scope.
  - Schema: `financial_assets` (institution, asset_type/סוג חיסכון, label, owner,
    currency, archived) + `asset_snapshots` (one balance update per asset/date,
    with optional deposits/הפקדות and a note; UNIQUE(asset_id, snapshot_date) so
    re-saving a date overwrites it). History is kept so each holding's growth is
    visible (per-row "שינוי" vs the previous snapshot).
  - `db/assets.js` (CRUD + `assetsSummary`: totals ILS-only, breakdowns by
    institution/type/owner) and `routes/assets.js` under `/api/assets`. Summary
    sums ILS holdings only — non-ILS (e.g. IB in USD) are listed per-asset but not
    folded into the grand total.
  - UI `client/src/pages/AssetsPage.jsx`: summary cards (total / last deposits /
    by-type), an asset list with "עדכן יתרה" (monthly snapshot), היסטוריה, edit and
    delete. Institution & type dropdowns have a free-text "אחר…" fallback.
  - Tests: `tests/test_assets.js` (7). Full suite: 13 files passing.
  - NOTE: archived asset = closed/sold; kept for history, out of all totals.
- **Assets: categories, liabilities, reordering, net worth (2026-06-14):**
  - Added 3 columns to `financial_assets` (migrations in `database.js`):
    `kind` ('asset'/'liability'), `category` (קטגוריה: נדל״ן/שוק ההון/הלוואות
    חברתיות/קרן ביטחון/חיסכון פנסיוני/מזומן), `sort_order` (manual order).
  - `kind='liability'` rows (e.g. הלוואת בנק ממזרחי) reuse the same snapshot
    mechanism for manual balance updates, shown in a separate "התחייבויות" section.
  - `assetsSummary` now returns `gross` (sum of assets), `totalLiabilities`,
    `net` (gross − liabilities), `byCategory`, plus asset/liability counts.
    Breakdowns are assets-only. `total` kept = `gross` for back-compat.
  - `moveAsset(db, id, direction)` swaps `sort_order` with the same-kind neighbour
    (assets & liabilities ordered independently); route `PUT /api/assets/:id/move`.
  - UI: up/down arrows per row, ברוטו/התחייבויות/נטו summary cards, by-category +
    by-type breakdown cards, category badge, liabilities shown in red with a minus.
  - Tests: `tests/test_assets.js` now 11 (added liability net, by-category, move).
- **OneZero SMS-OTP linking (2026-06-15):**
  - OneZero logs in with a one-time SMS code. Added a one-time link flow: trigger
    an SMS, user enters the code, the library returns a long-term token stored as
    `otpLongTermToken` in the account credentials so future scrapes skip the OTP.
  - `scraper.js`: `oneZeroStartOtp(account)` (triggerTwoFactorAuth, keeps the
    scraper instance with its OTP context in an in-memory 5-min session) and
    `oneZeroVerifyOtp(account, code)` (getLongTermTwoFactorToken → re-encrypt creds
    with the token). HTTP-only, no browser. Routes `POST /api/scrape/onezero/start`
    and `/verify`.
  - UI (`AccountsPage.jsx`): added the required `phoneNumber` field (international
    +972…) and a "חבר (SMS)" button with an inline code-entry panel for OneZero
    accounts. Also added a show/hide eye toggle on every credential password field.
  - BLOCKED: OneZero is behind Cloudflare, which rejects Node's TLS fingerprint
    with a 403 HTML challenge for every call (devices/token, otp/prepare, and the
    GraphQL data fetch) — the library uses Node `fetch`, so the whole flow fails
    with "Unexpected token '<'". `curl` from the same machine returns JSON, so it's
    a transport-fingerprint issue, not our code. `friendlyOneZeroError` now surfaces
    a clear Hebrew message instead of the parser error. A real fix needs a
    curl/impersonating-TLS transport or a CSV/Excel statement import. Deferred per
    user. The phoneNumber field and password eye-toggle are kept (both useful).
- **Fix: pending pre-authorization holds no longer duplicate (2026-06-15):**
  - Cards report a temporary `pending` hold for a recent purchase (Max with a
    zero amount, Cal/others with a real amount e.g. a ₪300 fuel pre-auth); the
    real charge later settles as a separate `completed` row with a different
    date/amount, so the content-hash dedup couldn't reconcile them and the hold
    lingered as a duplicate.
  - `save-transactions.js`: (1) skip zero-amount pending holds on import;
    (2) reconcile pending rows — after an import that returned data, delete any
    pending row for that account/sub-account, within the scraped date range, that
    this import no longer reported (it settled or was canceled). Works for any
    card regardless of amount/identifier. `removedPending` added to scrape stats.
  - One-time cleanup removed 10 stranded zero-amount pending rows (Max); DB backed
    up first to `data/backups/`.
  - Tests: `tests/test_save_transactions.js` now 17 (zero-skip, settle-removes-hold,
    still-pending-kept, empty-scrape guard, sub-account scoping).
- **Budgets rework: donut tiles, start date, carryover, income (2026-06-14):**
  - Budgets page redesigned from wide rows into a compact donut-tile grid
    (`client/src/pages/BudgetsPage.jsx`): center shows spent (big) + monthly
    remaining/חריגה (small); below: monthly limit + accumulated balance. Clicking a
    tile opens a modal editor (amount, scope, suggestion, transactions drill-down).
  - Budget start date: new `budgets.effective_from` ('YYYY-MM', '' = legacy/always;
    migration in `database.js`). The recurring default applies only from that month
    onward. Editor lets you pick the start month ("תקציב קבוע — חל מהחודש").
  - Accumulated envelope balance ("מצטבר", +/−): `budgetEnvelope` sums
    (limit − spent) over every month from a category's start through the selected
    month — both under- and over-spend carry forward. Returned per row as
    `carryover` from `computeBudgetOverview`.
  - Category reordering: `moveCategory(db, id, direction)` swaps `sort_order` with
    the same-section neighbour (income vs expense kept independent); route
    `PUT /api/categories/:id/move`. Up/down arrows on every tile.
  - Income split out: `computeIncomeOverview` returns income-flagged categories with
    an expected-income target (their "budget") vs actual earned. They no longer sit
    among expense tiles. New balance plaque (income / expenses / מאזן, בתקציב vs
    בפועל) + a separate "הכנסות" tile section. Overview route returns `incomeRows`.
  - Tests: `tests/test_budgets.js` now 15 (carryover, effective_from, income split);
    `tests/test_categories_store.js` now 11 (moveCategory).
- **One-click close: app window + terminal (2026-06-14):**
  - Server opens the app in a dedicated Chrome/Edge `--app` window on startup
    (`openAppWindow` in `server/index.js`; Windows-first, falls back to default
    browser; `NO_OPEN=1` skips it). An app window has a single history entry, so
    the in-app close button's `window.close()` is allowed to shut it.
  - "סגירת התוכנה" now also calls `window.close()` after `/api/app/shutdown`
    (Dashboard.jsx); the end screen stays as a fallback for manually-opened tabs.
  - `myfinance/MyBudget.bat` launcher: double-click to start; when the server
    exits (close button), the process ends and the cmd window closes itself.
- **Budgets: monthly summary table (2026-06-14):**
  - Bottom-of-page roll-up: planned vs actual income/expenses + balance (מאזן)
    for every month that has transaction data, with a grand-total row.
    `monthlyBudgetSummary` in `db/budgets.js`, `GET /api/budgets/monthly-summary`,
    `MonthlySummaryTable` in `BudgetsPage.jsx` (actual on top, budget muted below).
  - Tests: `tests/test_budgets.js` now 16 (monthly roll-up).
- **Compare page: monthly matrix + quick-select + income/net + averages (2026-06-17):**
  - New `GET /api/stats/matrix` (in `routes/stats.js`): per-month per-category
    expense breakdown plus per-month `income` and `net` (income − expenses) for a
    free set of months and accounts. Income categories and excluded categories are
    kept out of the expense rows (same rules as the Overview).
  - `ComparePage.jsx` matrix table at the top: categories as rows, every selected
    month as a column. Month headers are colour-coded (blue = period A,
    grey = period B, purple = both). Clicking a category row expands the
    transactions behind it inline (reuses `GET /api/stats/transactions`).
  - Footer rows per month: total expenses (סה"כ הוצאות), income (הכנסות) and
    net (נטו, green/red by sign).
  - Trailing summary column (far left in RTL, "ממוצע / סה\"כ"): per-category
    average per month in the data rows, grand total in the footer rows.
  - `PeriodPicker` quick-select: "all" (הכל), "clear" (נקה) and per-year buttons,
    on top of the existing month chips and presets.

- **Bulk category edit + manual-category protection (2026-07-20):**
  - Transactions page: checkbox column with per-page "select all", a bulk action
    bar (move N selected transactions to a chosen category), and a
    "select all X filtered results" escalation that applies server-side to
    everything matching the current filters. New filter: "רק מטבע חוץ"
    (foreign-currency only — the strongest signal for spending abroad).
  - API: `PUT /api/transactions/bulk/category` accepts `{ ids, category }` or
    `{ filters, category }` (same filter keys as the list endpoint; refuses a
    filterless bulk update). Filter building refactored into `buildTxnFilters`
    shared by both endpoints.
  - New `transactions.category_manual` flag (schema + idempotent migration):
    set to 1 on every manual category change (single or bulk). Rules,
    `recategorizeAll` (both modes), `applyKeywordToAll` and
    `applyRuleToUncategorized` now skip manual rows — a user's explicit choice
    is never overwritten by rules or future scrapes. Original scraper data
    remains intact in `raw_payload_json`.
  - Tests: `tests/test_bulk_category.js` (8). Full suite passing (78 total).

- **Transactions: totals for the selected rows (2026-07-31):**
  - Ticking one or more rows on the Transactions page now shows a summary strip
    above the bulk action bar: net total (green/red by sign), income (+),
    expenses (−, shown as a positive magnitude) and the transaction count.
    Sign convention follows `amount` — expense < 0, income > 0 — the same field
    every dashboard chart already sums, so the numbers stay consistent.
    Internal transfers are included as-is (deliberate choice, not an oversight).
  - Three ways to select: per-row checkbox, the header checkbox (everything on
    screen), and the existing "select all X filtered results" escalation — the
    last one totals server-side across all pages, not just the visible one.
  - Client selection state moved from a `Set` of ids to a `Map` of id → signed
    amount (`TransactionsPage.jsx`), so a selection spanning several pages still
    totals correctly without a round-trip. `applyBulkCategory` now sends
    `[...selected.keys()]`.
  - API: `GET /api/transactions/summary` returns `{ count, income, expense, net }`.
    Accepts either `?ids=1,2,3` (chunked to stay under SQLite's bound-variable
    limit) or the same filter keys as the list endpoint, via the shared
    `buildTxnFilters`. Logic extracted into the exported `summarizeTransactions`
    so it is testable without booting Express.
  - Tests: `tests/test_txn_summary.js` (11). Full suite passing (135 total).
  - NOTE: `amount` holds `chargedAmount`. For an account held in foreign currency
    (e.g. OneZero) `charged_currency` may not be ILS, so the total would mix
    currencies. Pre-existing behaviour across the whole dashboard; a per-currency
    split is a possible follow-up.

- **Insights page — "תובנות" (2026-09-13):**
  - New tab between השוואה and חשבונות: seven monthly-level readings that explain
    the family's financial mechanism instead of listing numbers (chosen from a
    GPT brainstorm of 12; see the tab's own notes for the rules):
    1. **החודש המייצג** — typical income per payer + median expenses (a single
       unusual month doesn't move it), annualised gap, p25–p75 range, volatility
       level (stable/moderate/volatile) and pattern (one-off outlier vs "a
       different surprise every month"). Income is NOT the raw monthly median:
       `incomeComposition` clusters payers (bank-transfer memos → shared ≥3-word
       prefix), then a 'regular' payer (N−1…N+1 payments of a stable amount)
       contributes its median payment once a month — so a salary landing on the
       31st one month and the 1st the next (0/2-salary months) doesn't distort
       it; 'irregular' payers contribute total÷N; a 'one-off' (single payment in
       ≥4 months) is excluded and listed for review (often an own-account
       transfer filed as income). The card shows the composition table.
    2. **מבני או התנהגותי** — fixed obligations (auto-detected recurring
       merchants + installment charges) vs variable spending vs income; verdict
       balanced / structural (fixed ≥60% of income or leave nothing) /
       behavioral (fixed leave room, variable exceeds it) / no-income. Also:
       new recurring charges (3 consecutive months, never before), vanished
       ones (absent in the last 2 months), price increases (≥10%).
    3. **מה יוצר את הפער** — top categories by amount AND by over-budget, each
       with charges/month, average ticket and a "many small / few large" tag.
    4. **תקציב ריאלי או משאלת לב** — per budgeted category: months over,
       median, p75; verdict wishful (over ≥⅔ of months, median ≥110% of limit →
       suggest median), loose (median <70%, rarely over → suggest p75),
       realistic; planningGap = Σ(median − limit) over wishful ones.
    5. **האם יש שיפור** — recent half of the window vs the earlier half:
       expenses, income (one-off income excluded, so a transfer can't pose as
       improvement), net, budget breaches/month, share left in 'אחר'
       (bookkeeping accuracy), biggest movers up/down; verdict
       improving/worsening/flat (±3% of income on net or ±5% expenses).
    6. **הוצאות תקופתיות** — merchants seen in ≤2 months with a big charge
       (≥ max(300, 1.5% of monthly spend)) → total, per-month set-aside
       (rounded to 50), by category; "lumpy" categories (CV ≥ 0.6).
    7. **תשלומים וחובות** — installment plans reconstructed from
       (merchant, total, original price) with the latest installment number:
       per-month burden and share of income, remaining debt, 12-month forward
       schedule, plans ending within 6 months (money freed), plans opened in the
       window, recently finished, stale (unseen 3+ months) and unparsed ones;
       liabilities from the assets sheet.
  - A "בארבע שורות" summary on top (normal month / what creates the gap / what
    changed / what to check). Window selector: 3 / 6 / 12 / all COMPLETE months —
    the current month is never included.
  - Every card ends with a "שימו לב" block: 1–4 plain-language points derived
    from the numbers (what it means + what to do), e.g. fixed-share benchmarks
    (<40% comfortable, 40–60% tight, >60% structural), what a new/pricier
    subscription costs per year, "many small" vs "few large" tactics, wishful
    budgets ("two real options"), seasonality caveats, the set-aside mechanism,
    installment share thresholds (<5% / 5–10% / >10% of income).
  - Verified against the real DB: month-by-month income and expenses are
    identical to the Budgets page monthly summary (diff 0). The raw monthly
    median income WAS inflated there by salary timing (7 salaries in 4 of 6
    months) and one-off credits — hence the per-payer typical income.
  - Conventions match the Budgets monthly summary: included accounts minus
    excluded sub-accounts, no transfers, no excluded categories, expenses =
    negatives in non-income categories, income = positives in income categories,
    months by transaction date.
  - Recurring detection (`detectRecurring`): merchant key = description with
    digits/punctuation stripped; 'monthly' = present in ≥ max(3, N−1) months,
    ≤2 charges/month, MAD ≤ 0.5; 'periodic' = ≥3 and ≥N/2 months, evenly spaced
    (gap spread ≤1), ≤1.5/month, MAD ≤ 0.2. Food / restaurants / shopping
    merchants only qualify with MAD ≤ 0.1 (a real subscription, not a habit).
  - Code: `server/db/insights.js` (pure functions, ~25ms on the real DB),
    `server/routes/insights.js` (`GET /api/insights?months=6|all`),
    `client/src/pages/InsightsPage.jsx`; `effectiveLimitsByMonth` exported from
    `db/budgets.js`. Tests: `tests/test_insights.js` (28). Full suite: 164 passing.
  - Balance history (prerequisite for a future cash-flow / net-worth timeline —
    GPT's #9): new `account_balance_history` table (one row per account number
    per day, written by `upsertBalance` on every sync; cards skipped),
    `balanceHistory()` in `db/balances.js`. Starts accumulating silently on the
    next sync; nothing shows it yet.
  - Demo server for UI checks without real data: `node tests/demo-server.mjs`
    boots the real app on a throwaway temp folder with fake data (2 accounts,
    8 months, installments, a loan), port 3777, already unlocked with a dummy
    password. Enabled by two new env overrides: `MYFINANCE_DATA_DIR` (database.js)
    and `PORT` (index.js; allowed origins follow it). Also a "myfinance-demo"
    entry in `.claude/launch.json`.
  - Not done (by design): GPT's #9 cash-flow timing needs the balance history to
    accumulate first; #10 "big easy wins" falls out of the recurring list; #11–12
    are family decisions, not analysis.

- **Credit cards: the upcoming charge (2026-11-05):**
  - Cards report no balance, so the Accounts page showed nothing next to them.
    Each card login now shows its next debit in amber — e.g. "לחיוב 09/11: ₪1,953"
    — and the per-card breakdown shows the same per card number. Banks are
    untouched and keep showing "יתרה".
  - Definition (`server/db/card-charges.js`): card scrapers set `processed_date`
    to the day a transaction will be charged, so the upcoming charge is the
    earliest `processed_date` still today-or-later, and the net sum of every
    transaction carrying that date — refunds and pending rows included. Next
    month's installments sit on a later date and are deliberately left out.
  - Only real card sources (cal / isracard / max) count. Manual entries copy the
    expense date into `processed_date`, which is not a charge date, so they are
    excluded; bank logins therefore never report a charge.
  - Login level = the single debit the bank will see (one date, all cards on it).
    Card level = each card's own nearest date, so cards on different cycles are
    each reported correctly. Excluded cards still count in the login total,
    because the bank is charged for them regardless.
  - The number is "what is known so far" for that date and keeps growing until
    the charge day — the tooltip on it says so.
  - API: `GET /api/accounts` and `GET /api/accounts/:id/subaccounts` gained
    `upcoming_charge` (positive = money leaving, negative = net refund),
    `upcoming_charge_date` and `upcoming_charge_txns`; all null when nothing is
    pending.
  - Tests: `tests/test_card_charges.js` (12). Full suite passing (147 total).

- **Credit cards: total of the upcoming charges (2026-11-05):**
  - A strip at the top of the Accounts page now sums what all the cards are
    about to take out: "סך החיוב הקרוב בכרטיסים ₪12,546", with the card count,
    the date (or date range) and the number of transactions behind it.
  - Each card contributes **its own** next charge, so cards on different billing
    cycles are all represented; the date range makes that visible.
  - Counted only for cards that count toward totals — the login is ticked
    "כלול בחישובים" AND the card number is not individually excluded, the
    same rule the rest of the app uses. Cards left out are reported in the strip
    ("לא נכללו N כרטיסים") rather than silently dropped, so the number is
    never quietly smaller than it looks.
  - Deliberate asymmetry: a *login* line still shows the full debit including
    excluded cards (that is what the bank will actually take), while the total
    respects the user's inclusion choices. Both are documented in the tooltips.
  - API: `GET /api/accounts/upcoming-charge` →
    `{ amount, from, to, cards, txns, skipped: { cards, amount } }`.
    `upcomingChargeByCard` exposes the per-card rows with an `included` flag.
  - Tests: `tests/test_card_charges.js` grew to 20. Full suite passing (155 total).

## Next steps
- Re-sync accounts to populate balances (banks only; cards have no balance)
- Insights follow-ups: balance-over-time chart once `account_balance_history` has a few weeks of data; per-merchant "not fixed" override for the recurring list; net-worth trend when monthly asset snapshots accumulate
- Validate the remaining wired sources (Mizrahi, OneZero) against real accounts
- Let the user grow their own rule set from the real "אחר" transactions in Cal
- Code-split the client bundle (recharts pushed it past 500 kB)
- Optional: budget vs. actual on the Overview dashboard
