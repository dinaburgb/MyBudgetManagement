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

## Next steps
- Validate the remaining wired sources (Mizrahi, OneZero, Isracard, Max) against real accounts
- Let the user grow their own rule set from the real "אחר" transactions in Cal
- Budget limits per category (set a monthly cap, track against it)
- Reporting / analytics on the dashboard (charts by month and by category)
