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
| OneZero           | onezero    | ⚙️ Wired       | Configured, not yet tested with real account     |
| Isracard          | isracard   | ⚙️ Wired       | Configured, not yet tested with real account     |
| Max               | max        | ⚙️ Wired       | Configured, not yet tested with real account     |

## Current status
- Phase 1 (foundation: auth, DB, accounts, transactions UI) — done
- Phase 2 (scraping, deduplication, save to DB) — done
- Security review + CORS lockdown to localhost only — done
- **Visa Cal connected (2026-06-12):** first sync imported 87 transactions on card 7364
  (8 additional cards under the same login returned no transactions).
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

## Next steps
- Re-sync accounts to populate balances (banks only; cards have no balance)
- Validate the remaining wired sources (Mizrahi, OneZero, Isracard, Max) against real accounts
- Let the user grow their own rule set from the real "אחר" transactions in Cal
- Code-split the client bundle (recharts pushed it past 500 kB)
- Optional: budget vs. actual on the Overview dashboard
