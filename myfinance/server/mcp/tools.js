/**
 * Read-only data tools behind the MCP server.
 *
 * Every function here takes the database handle explicitly and only ever reads.
 * No function touches `accounts.credentials` — the encrypted bank logins are
 * never selected, never returned, and an assistant connected over MCP has no
 * way to reach them.
 *
 * The "what counts" rule is the same one the dashboard uses everywhere, so a
 * number answered here reconciles with the number on screen:
 *   - only logins flagged include_in_totals, minus individually excluded
 *     account numbers / cards
 *   - internal transfers and excluded categories (e.g. credit-card repayment,
 *     already itemised) are ignored
 *   - expenses = negative amounts in non-income categories
 *   - income   = positive amounts in income-flagged categories
 *   - months are attributed by transaction date
 */

import { notExcludedSql } from '../db/subaccounts.js'
import { balancesByAccount, netBalance } from '../db/balances.js'
import { upcomingChargeByCard, upcomingChargeByAccount, upcomingChargeTotal, CARD_SOURCES } from '../db/card-charges.js'
import { computeBudgetOverview, computeIncomeOverview } from '../db/budgets.js'
import { computeInsights } from '../db/insights.js'

/** Rows that count toward the totals — the join + filters shared by the tools. */
const COUNTED = `
  JOIN accounts a ON a.id = t.account_id
  WHERE a.include_in_totals = 1
    AND ${notExcludedSql('t.account_id', 't.account_number')}
    AND t.is_transfer = 0
    AND t.category NOT IN (SELECT name FROM categories WHERE is_excluded = 1)`

const INCOME_CATS = `(SELECT name FROM categories WHERE is_income = 1)`

const round2 = n => Math.round(Number(n || 0) * 100) / 100

/**
 * Round every number in a nested result to 2 decimals. The raw sums carry float
 * noise (25767.970000000005) which is both unreadable in an answer and wasteful
 * to send over the wire.
 */
function roundDeep(v) {
  if (typeof v === 'number') return round2(v)
  if (Array.isArray(v)) return v.map(roundDeep)
  if (v && typeof v === 'object') {
    const out = {}
    for (const [k, x] of Object.entries(v)) out[k] = roundDeep(x)
    return out
  }
  return v
}
const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

/** 'YYYY-MM' shifted back by n months. */
function monthsBackFrom(key, n) {
  const [y, m] = key.split('-').map(Number)
  const d = new Date(y, m - 1 - n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 * Every bank login and card: what it holds or is about to be charged, and
 * whether it counts toward the totals. Credentials are never read.
 */
export function listAccounts(db) {
  const rows = db.prepare(`
    SELECT id, name, source, owner, last_scraped, enabled, include_in_totals,
           (SELECT COUNT(*) FROM transactions t WHERE t.account_id = accounts.id) AS transactions
    FROM accounts ORDER BY sort_order, source, owner
  `).all()
  const balances = balancesByAccount(db)
  const charges  = upcomingChargeByAccount(db)

  const accounts = rows.map(r => {
    const b = balances.get(r.id)
    const c = charges.get(r.id)
    return {
      name: r.name,
      kind: CARD_SOURCES.includes(r.source) ? 'card' : 'bank',
      source: r.source,
      owner: r.owner,
      counts_toward_totals: !!r.include_in_totals,
      balance: b && b.balance != null ? round2(b.balance) : null,
      upcoming_charge: c ? round2(c.amount) : null,
      upcoming_charge_from: c ? c.from : null,
      upcoming_charge_to: c ? c.to : null,
      transactions: r.transactions,
      last_synced: r.last_scraped,
    }
  })
  return {
    accounts,
    total_bank_balance: round2(accounts
      .filter(a => a.kind === 'bank' && a.counts_toward_totals && a.balance != null)
      .reduce((s, a) => s + a.balance, 0)),
    note: 'balance is null for cards (issuers report none) and for logins with no synced balance.',
  }
}

/**
 * What the credit cards are about to take out of the bank accounts: each card's
 * next charge, plus the total over the cards that count toward totals.
 */
export function upcomingCardCharges(db) {
  const names = new Map(db.prepare(`SELECT id, name FROM accounts`).all().map(r => [r.id, r.name]))
  const total = upcomingChargeTotal(db)
  return {
    total: round2(total.amount),
    from: total.from,
    to: total.to,
    cards_counted: total.cards,
    transactions: total.txns,
    excluded: { cards: total.skipped.cards, amount: round2(total.skipped.amount) },
    cards: upcomingChargeByCard(db).map(c => ({
      account: names.get(c.account_id) || String(c.account_id),
      card: c.account_number,
      charge_date: c.date,
      amount: round2(c.amount),
      transactions: c.txns,
      counts_toward_totals: c.included,
    })),
    note: 'amount is positive when money leaves the account. A charge keeps growing until its charge date.',
  }
}

/** Income, expenses and the gap, month by month (most recent last). */
export function monthlySummary(db, { months = 6, now = new Date() } = {}) {
  const count = Math.min(Math.max(Number(months) || 6, 1), 36)
  const current = monthKey(now)
  const keys = Array.from({ length: count }, (_, i) => monthsBackFrom(current, count - 1 - i))
  const ph = keys.map(() => '?').join(',')
  const rows = db.prepare(`
    SELECT substr(t.date, 1, 7) AS month,
           SUM(CASE WHEN t.amount > 0 AND t.category IN ${INCOME_CATS} THEN t.amount ELSE 0 END)      AS income,
           SUM(CASE WHEN t.amount < 0 AND t.category NOT IN ${INCOME_CATS} THEN -t.amount ELSE 0 END) AS expenses,
           COUNT(*) AS transactions
    FROM transactions t ${COUNTED}
      AND substr(t.date, 1, 7) IN (${ph})
    GROUP BY month ORDER BY month
  `).all(...keys)

  const byMonth = new Map(rows.map(r => [r.month, r]))
  return {
    months: keys.map(m => {
      const r = byMonth.get(m) || { income: 0, expenses: 0, transactions: 0 }
      return {
        month: m,
        income: round2(r.income),
        expenses: round2(r.expenses),
        net: round2(r.income - r.expenses),
        transactions: r.transactions,
        partial: m === current,   // the current month is still filling up
      }
    }),
    note: 'the current month is marked partial — do not compare it with full months.',
  }
}

/** Where the money went: expenses per category over a date range. */
export function categoryBreakdown(db, { from = null, to = null, limit = 15 } = {}) {
  const cap = Math.min(Math.max(Number(limit) || 15, 1), 100)
  const where = []
  const params = []
  if (from) { where.push('t.date >= ?'); params.push(String(from)) }
  if (to)   { where.push('t.date <= ?'); params.push(String(to)) }
  const extra = where.length ? ` AND ${where.join(' AND ')}` : ''

  const rows = db.prepare(`
    SELECT t.category,
           SUM(-t.amount) AS spent,
           COUNT(*)       AS transactions
    FROM transactions t ${COUNTED}
      AND t.amount < 0 AND t.category NOT IN ${INCOME_CATS}${extra}
    GROUP BY t.category ORDER BY spent DESC LIMIT ${cap}
  `).all(...params)

  const total = rows.reduce((s, r) => s + r.spent, 0)
  return {
    from, to,
    total_spent: round2(total),
    categories: rows.map(r => ({
      category: r.category,
      spent: round2(r.spent),
      share: total > 0 ? Math.round((r.spent / total) * 1000) / 10 : 0,
      transactions: r.transactions,
    })),
  }
}

/** Find transactions. Text matches the description, the memo and your own note. */
export function searchTransactions(db, { text = '', category = null, from = null, to = null, limit = 50, all_accounts = false } = {}) {
  const cap = Math.min(Math.max(Number(limit) || 50, 1), 500)
  const where = []
  const params = []
  if (text)     { where.push('(t.description LIKE ? OR t.memo LIKE ? OR t.note LIKE ?)'); const q = `%${text}%`; params.push(q, q, q) }
  if (category) { where.push('t.category = ?'); params.push(String(category)) }
  if (from)     { where.push('t.date >= ?');    params.push(String(from)) }
  if (to)       { where.push('t.date <= ?');    params.push(String(to)) }

  // all_accounts drops the "counts toward totals" filter, for finding something
  // in a login or card the user keeps out of the sums.
  const base = all_accounts
    ? `JOIN accounts a ON a.id = t.account_id WHERE 1 = 1`
    : COUNTED
  const extra = where.length ? ` AND ${where.join(' AND ')}` : ''

  const rows = db.prepare(`
    SELECT t.date, t.processed_date, t.description, t.memo, t.note, t.amount, t.category,
           a.name AS account, t.account_number AS card, t.type,
           t.installment_number, t.installment_total, t.status
    FROM transactions t ${base}${extra}
    ORDER BY t.date DESC, t.id DESC LIMIT ${cap}
  `).all(...params)

  return {
    count: rows.length,
    limit: cap,
    transactions: rows.map(r => ({
      date: r.date,
      charge_date: r.processed_date,
      description: r.description,
      memo: r.memo || undefined,
      note: r.note || undefined,
      amount: round2(r.amount),
      category: r.category,
      account: r.account,
      card: r.card || undefined,
      installment: r.type === 'installment' ? `${r.installment_number}/${r.installment_total}` : undefined,
      status: r.status !== 'completed' ? r.status : undefined,
    })),
    note: 'amount is signed: negative = expense, positive = income.',
  }
}

/**
 * Budget vs actual for one month ('YYYY-MM'; defaults to the current one).
 * Categories with neither a budget nor any spending are left out, so the answer
 * is the handful of lines that actually say something.
 */
export function budgetStatus(db, { month = null, now = new Date() } = {}) {
  const key = month && /^\d{4}-\d{2}$/.test(month) ? month : monthKey(now)

  const rows = computeBudgetOverview(db, key)
    .filter(r => r.limit != null || r.spent > 0)
    .map(r => ({
      category: r.category,
      budget: r.limit != null ? round2(r.limit) : null,
      spent: round2(r.spent),
      remaining: r.remaining != null ? round2(r.remaining) : null,
      over_budget: r.limit != null && r.spent > r.limit,
      carryover: r.carryover != null ? round2(r.carryover) : null,
    }))
    .sort((a, b) => b.spent - a.spent)

  const income = computeIncomeOverview(db, key)
    .filter(r => r.limit != null || r.earned > 0)
    .map(r => ({
      category: r.category,
      expected: r.limit != null ? round2(r.limit) : null,
      earned: round2(r.earned),
      gap: r.remaining != null ? round2(r.remaining) : null,
    }))

  const budgeted = rows.filter(r => r.budget != null)
  return {
    month: key,
    total_budget: round2(budgeted.reduce((s, r) => s + r.budget, 0)),
    total_spent: round2(rows.reduce((s, r) => s + r.spent, 0)),
    spent_in_budgeted_categories: round2(budgeted.reduce((s, r) => s + r.spent, 0)),
    unbudgeted_spending: round2(rows.filter(r => r.budget == null).reduce((s, r) => s + r.spent, 0)),
    over_budget: rows.filter(r => r.over_budget).map(r => r.category),
    rows,
    income,
    note: 'carryover is the running balance of the envelope (budget minus spending) from the first month of the budget through this one. Categories with no budget and no spending are omitted.',
  }
}

/**
 * The monthly-level readings from the Insights page, trimmed to what reads well
 * as an answer: the representative month, the structure of the spending, what
 * drives the gap, budget realism, progress, periodic expenses and installments.
 */
export function insights(db, { monthsBack = 6, now = new Date() } = {}) {
  const back = Math.min(Math.max(Number(monthsBack) || 6, 3), 36)
  const d = computeInsights(db, { monthsBack: back, now })

  // The Insights page needs the long tails (every recurring merchant, the
  // transactions behind each irregular expense) to render its drill-downs.
  // An answer does not: it needs the head of each list. Trimming here keeps a
  // single call from flooding the assistant's context with rows nobody reads.
  const take = (arr, n) => (Array.isArray(arr) ? arr.slice(0, n) : arr)
  const recurring = d.structure?.recurring
  const { finishedRecently, ...installments } = d.installments || {}

  return roundDeep({
    window: d.window,
    representative_month: d.representative,
    structural_or_behavioural: {
      ...d.structure,
      recurring: recurring ? { ...recurring, merchants: take(recurring.merchants, 15) } : recurring,
    },
    gap_drivers: { ...d.drivers, categories: take(d.drivers?.categories, 10) },
    budget_realism: d.budgetRealism,
    progress: d.progress,
    periodic_expenses: {
      ...d.periodic,
      items: take(d.periodic?.items, 12)?.map(({ txns, ...item }) => item),
    },
    installments: { ...installments, endingSoon: take(installments.endingSoon, 5) },
    note: 'computed over complete months only — the current month is excluded. Lists are trimmed to the largest entries; use search_transactions for the rows behind one.',
  })
}

/** Net balance across the logins that count toward the totals. */
export function netWorthSnapshot(db) {
  const includedIds = db.prepare(`SELECT id FROM accounts WHERE include_in_totals = 1`).all().map(r => r.id)
  return {
    net_bank_balance: round2(includedIds.length ? netBalance(db, includedIds) : 0),
    upcoming_card_charges: round2(upcomingChargeTotal(db).amount),
    note: 'bank balances minus nothing — the card charges have not left the accounts yet.',
  }
}
