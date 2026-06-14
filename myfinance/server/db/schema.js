/**
 * Database schema — all SQL CREATE TABLE statements.
 * Using Node.js built-in node:sqlite (available since Node v22.5).
 */

export const SCHEMA_SQL = `

-- Stores encrypted credentials for each bank/card account
CREATE TABLE IF NOT EXISTS accounts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,          -- display name, e.g. "Hapoalim — Boris"
  source       TEXT NOT NULL,          -- hapoalim / discount / fibi / mizrahi / onezero / isracard / cal / max
  owner        TEXT NOT NULL DEFAULT 'Boris',  -- Boris / Irena / Joint
  credentials  TEXT NOT NULL,          -- AES-256-GCM encrypted JSON blob
  last_scraped TEXT,                   -- ISO timestamp of last successful scrape
  enabled      INTEGER NOT NULL DEFAULT 1,
  include_in_totals INTEGER NOT NULL DEFAULT 1,  -- 0 = exclude from summaries/totals
  sort_order   INTEGER NOT NULL DEFAULT 0,       -- manual display order (lower = higher up)
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Every financial transaction from all accounts
CREATE TABLE IF NOT EXISTS transactions (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id         TEXT,            -- original ID from the bank (if available)
  dedup_key           TEXT NOT NULL UNIQUE,  -- hash used to prevent duplicates
  raw_payload_json    TEXT NOT NULL,   -- original data from scraper — NEVER delete this
  date                TEXT NOT NULL,   -- transaction date (YYYY-MM-DD)
  processed_date      TEXT,            -- date bank processed it (may differ)
  amount              REAL NOT NULL,   -- negative = expense, positive = income
  original_amount     REAL,
  original_currency   TEXT DEFAULT 'ILS',
  charged_amount      REAL,
  charged_currency    TEXT DEFAULT 'ILS',
  description         TEXT NOT NULL DEFAULT '',
  memo                TEXT DEFAULT '',          -- raw memo from the scraper (do not overwrite)
  note                TEXT DEFAULT '',          -- user's own free-text note on the transaction
  category            TEXT DEFAULT 'Other',
  owner               TEXT DEFAULT 'Boris',  -- Boris / Irena / Joint
  account_id          INTEGER REFERENCES accounts(id),
  account_number      TEXT,
  account_name        TEXT,
  source              TEXT NOT NULL,   -- hapoalim / discount / etc.
  card_last4          TEXT,
  type                TEXT DEFAULT 'normal',        -- normal / installment
  installment_number  INTEGER,
  installment_total   INTEGER,
  is_transfer         INTEGER NOT NULL DEFAULT 0,   -- 1 = internal transfer between own accounts (ignored in totals)
  status              TEXT DEFAULT 'completed',     -- completed / pending
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes for fast filtering. dedup_key already has a unique index from its
-- UNIQUE constraint above.
CREATE INDEX IF NOT EXISTS idx_transactions_date     ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_source   ON transactions(source);
CREATE INDEX IF NOT EXISTS idx_transactions_owner    ON transactions(owner);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category);
CREATE INDEX IF NOT EXISTS idx_transactions_account  ON transactions(account_id);

-- Auto-categorization rules: if description contains keyword → assign category
CREATE TABLE IF NOT EXISTS category_rules (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword    TEXT NOT NULL,   -- match against lowercased description
  category   TEXT NOT NULL,
  priority   INTEGER DEFAULT 0,  -- higher number = checked first
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- User-manageable list of categories. Seeded with a canonical Hebrew set on first
-- run; the user can add, rename, recolor, or delete their own. 'אחר' is a system
-- category (the catch-all) and cannot be deleted.
CREATE TABLE IF NOT EXISTS categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  color      TEXT,                       -- hex color for charts
  is_system  INTEGER NOT NULL DEFAULT 0, -- 1 = cannot be deleted (e.g. 'אחר')
  is_income  INTEGER NOT NULL DEFAULT 0, -- 1 = income category (kept out of the expense pie)
  is_excluded INTEGER NOT NULL DEFAULT 0,-- 1 = ignore entirely in totals (e.g. credit-card repayment, already itemized)
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Latest balance per account/card, as of the last scrape ("balance on update day").
-- One login (accounts row) can expose several account numbers, each with its own
-- balance; we keep the most recent value per (account_id, account_number).
-- Banks return a real balance; credit cards usually return null here.
CREATE TABLE IF NOT EXISTS account_balances (
  account_id     INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  account_number TEXT NOT NULL,
  balance        REAL,
  balance_date   TEXT,                      -- scrape time (ISO) the balance is from
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (account_id, account_number)
);

-- Monthly budget limits per category.
-- month = '' means a recurring default that applies to every month; a specific
-- 'YYYY-MM' row overrides the default for that one month.
CREATE TABLE IF NOT EXISTS budgets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  category   TEXT NOT NULL,
  month      TEXT NOT NULL DEFAULT '',  -- '' = recurring default, else 'YYYY-MM'
  amount     REAL NOT NULL,             -- positive monthly limit in ILS
  effective_from TEXT NOT NULL DEFAULT '', -- 'YYYY-MM' the recurring default starts applying ('' = all months / legacy)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(category, month)
);

-- Sub-account exclusions. One bank login (accounts row) can expose several
-- account numbers (e.g. Discount returns 3). A row here means "exclude this
-- specific account number from totals", even though its parent login is included.
-- Absence = included (the default), so this table only lists the exceptions.
CREATE TABLE IF NOT EXISTS excluded_subaccounts (
  account_id     INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  account_number TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (account_id, account_number)
);

-- Optional user-given nicknames for sub-accounts (one account number under a
-- login, e.g. a specific credit card). Absence = no nickname; the number alone
-- is shown. Used to label cards like 8805 → "יומיומי" in the transactions source.
CREATE TABLE IF NOT EXISTS subaccount_labels (
  account_id     INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  account_number TEXT NOT NULL,
  label          TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (account_id, account_number)
);

-- Transfer pairs the user reviewed and said are NOT internal transfers, so the
-- pair suggester won't nag about them again. Ids are normalised low < high.
CREATE TABLE IF NOT EXISTS ignored_transfer_pairs (
  low_id     INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  high_id    INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (low_id, high_id)
);

-- Financial assets held at pension funds, insurance companies and investment
-- houses (Clal, Harel, Meitav, Mor, Excellence, Psagot, Interactive Brokers, ...).
-- A row here is one holding: an institution + a savings type + an owner. Data is
-- entered manually (updated about once a month); each balance update is stored as
-- a snapshot in asset_snapshots, so growth over time is kept.
CREATE TABLE IF NOT EXISTS financial_assets (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT NOT NULL DEFAULT 'asset',  -- 'asset' = holding, 'liability' = a debt/loan (subtracted in net total)
  category     TEXT DEFAULT '',          -- high-level grouping, e.g. 'נדל״ן', 'שוק ההון', 'הלוואות חברתיות', 'קרן ביטחון'
  institution  TEXT NOT NULL,            -- e.g. 'כלל ביטוח', 'הראל', 'אינטראקטיב ברוקרס', 'בנק מזרחי'
  asset_type   TEXT NOT NULL,            -- savings type, e.g. 'קרן פנסיה', 'קופת גמל', 'קרן השתלמות', 'תיק השקעות', 'הלוואה'
  label        TEXT DEFAULT '',          -- optional free-text name / policy number
  owner        TEXT NOT NULL DEFAULT 'Boris',  -- Boris / Irena / Joint
  currency     TEXT NOT NULL DEFAULT 'ILS',
  note         TEXT DEFAULT '',
  archived     INTEGER NOT NULL DEFAULT 0,  -- 1 = closed/sold, kept for history, out of totals
  sort_order   INTEGER NOT NULL DEFAULT 0,  -- manual display order within its kind (lower = higher up)
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One balance update for an asset, as of a given date (typically monthly). Keeps a
-- history so we can show how each holding grows. 'deposits' is how much was paid in
-- during the period leading to this snapshot (optional). One snapshot per asset/date.
CREATE TABLE IF NOT EXISTS asset_snapshots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id      INTEGER NOT NULL REFERENCES financial_assets(id) ON DELETE CASCADE,
  snapshot_date TEXT NOT NULL,           -- YYYY-MM-DD the balance is as of
  balance       REAL NOT NULL,           -- total holding value on that date
  deposits      REAL DEFAULT 0,          -- amount paid in during the period (optional)
  note          TEXT DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(asset_id, snapshot_date)
);
CREATE INDEX IF NOT EXISTS idx_asset_snapshots_asset ON asset_snapshots(asset_id);

-- Activity log — NO sensitive data, only operational events
CREATE TABLE IF NOT EXISTS activity_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  event      TEXT NOT NULL,   -- e.g. "scrape_started", "scrape_success", "scrape_error"
  source     TEXT,            -- which bank
  details    TEXT,            -- non-sensitive description
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

`
