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
  memo                TEXT DEFAULT '',
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
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(category, month)
);

-- Activity log — NO sensitive data, only operational events
CREATE TABLE IF NOT EXISTS activity_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  event      TEXT NOT NULL,   -- e.g. "scrape_started", "scrape_success", "scrape_error"
  source     TEXT,            -- which bank
  details    TEXT,            -- non-sensitive description
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

`
