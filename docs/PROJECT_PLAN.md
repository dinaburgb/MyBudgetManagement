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

## Next steps
- Re-sync accounts to populate balances (banks only; cards have no balance)
- Validate the remaining wired sources (Mizrahi, OneZero, Isracard, Max) against real accounts
- Let the user grow their own rule set from the real "אחר" transactions in Cal
- Code-split the client bundle (recharts pushed it past 500 kB)
- Optional: budget vs. actual on the Overview dashboard
