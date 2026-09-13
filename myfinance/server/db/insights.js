/**
 * Insights — a monthly-level reading of the family's finances that goes beyond
 * "you overspent on food". Seven questions, each answered from the transactions:
 *
 *   1. representative  — what does a NORMAL month look like (typical income per
 *                        payer, median expenses — not the mean), how big is the
 *                        real monthly gap, how volatile are we?
 *   2. structure       — is a deficit structural (fixed obligations eat the
 *                        income) or behavioural (variable spending)?
 *   3. drivers         — which 3–4 categories create the gap: amount AND frequency
 *   4. budgetRealism   — which budgets are realistic and which are wishful thinking
 *   5. progress        — recent months vs the months before: is it improving?
 *   6. periodic        — irregular / annual expenses → a monthly set-aside
 *   7. installments    — credit-card installment plans: burden, end dates, what frees up
 *
 * Conventions (they match the Budgets page monthly summary so numbers reconcile):
 *   - only accounts flagged include_in_totals, minus excluded sub-accounts
 *   - internal transfers and excluded categories are ignored everywhere
 *   - expenses = negative amounts in non-income categories
 *   - income   = positive amounts in income-flagged categories
 *   - months are attributed by transaction date (same as every other page)
 *   - only COMPLETE months are analysed: the current month is always left out
 */

import { getDb } from './database.js'
import { notExcludedSql } from './subaccounts.js'
import { incomeCategoryNames } from './categories.js'
import { effectiveLimitsByMonth } from './budgets.js'
import { OTHER_CATEGORY } from './categorize.js'

// ---------------------------------------------------------------------------
// Small numeric helpers
// ---------------------------------------------------------------------------

export function median(values) {
  const s = values.filter(v => Number.isFinite(v)).sort((a, b) => a - b)
  if (s.length === 0) return 0
  const h = s.length >> 1
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2
}

/** Linear-interpolated quantile, q in [0,1]. */
export function quantile(values, q) {
  const s = values.filter(v => Number.isFinite(v)).sort((a, b) => a - b)
  if (s.length === 0) return 0
  const pos = (s.length - 1) * q
  const lo = Math.floor(pos), hi = Math.ceil(pos)
  return s[lo] + (s[hi] - s[lo]) * (pos - lo)
}

function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0
}

function stdev(values) {
  if (values.length < 2) return 0
  const m = mean(values)
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1))
}

const round50 = n => Math.round(n / 50) * 50
const round1  = n => Math.round(n)

// ---------------------------------------------------------------------------
// Month helpers
// ---------------------------------------------------------------------------

export function monthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** 'YYYY-MM' shifted by n months (n may be negative). */
export function addMonths(key, n) {
  let [y, m] = key.split('-').map(Number)
  m += n
  y += Math.floor((m - 1) / 12)
  m = ((m - 1) % 12 + 12) % 12 + 1
  return `${y}-${String(m).padStart(2, '0')}`
}

/**
 * The complete months that have data, oldest first: every month with at least one
 * transaction in an included account, strictly before the current month. `count`
 * keeps only the most recent N; 'all' keeps every complete month.
 */
export function completeMonths(db, count = 6, now = new Date()) {
  const current = monthKey(now)
  const months = db.prepare(`
    SELECT DISTINCT substr(t.date, 1, 7) AS month
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE a.include_in_totals = 1 AND substr(t.date, 1, 7) < ?
    ORDER BY month
  `).all(current).map(r => r.month)
  if (count === 'all') return months
  const n = Number(count)
  return Number.isInteger(n) && n > 0 ? months.slice(-n) : months.slice(-6)
}

// ---------------------------------------------------------------------------
// Merchant normalisation
// ---------------------------------------------------------------------------

/**
 * Collapse a card/bank description to a merchant key: lowercase, digits and
 * punctuation removed (branch numbers, dates, reference codes), spaces squeezed.
 * "שופרסל דיל 123 ת\"א" and "שופרסל דיל 456 ת\"א" become the same merchant.
 */
export function normalizeMerchant(description) {
  return String(description || '')
    .toLowerCase()
    .replace(/\d+/g, ' ')
    .replace(/[^\p{L}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

/** All window transactions from included accounts, excluded categories dropped. */
function loadWindowRows(db, months) {
  if (!months.length) return []
  const ph = months.map(() => '?').join(',')
  return db.prepare(`
    SELECT t.id, substr(t.date, 1, 7) AS month, t.date, t.amount, t.category, t.description,
           t.type, t.installment_number, t.installment_total, t.original_amount
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE a.include_in_totals = 1
      AND ${notExcludedSql('t.account_id', 't.account_number')}
      AND t.is_transfer = 0
      AND substr(t.date, 1, 7) IN (${ph})
      AND t.category NOT IN (SELECT name FROM categories WHERE is_excluded = 1)
  `).all(...months)
}

/** Every installment charge ever seen (all months) — plans span the window. */
function loadInstallmentRows(db) {
  return db.prepare(`
    SELECT t.id, substr(t.date, 1, 7) AS month, t.date, t.amount, t.category, t.description,
           t.installment_number, t.installment_total, t.original_amount
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE a.include_in_totals = 1
      AND ${notExcludedSql('t.account_id', 't.account_number')}
      AND t.is_transfer = 0
      AND t.type = 'installment'
      AND t.category NOT IN (SELECT name FROM categories WHERE is_excluded = 1)
    ORDER BY t.date, t.id
  `).all()
}

// Categories that are habits, not obligations: a merchant here only counts as a
// recurring charge when the amount is practically identical every month (a real
// subscription), not merely because the family eats out or shops every month.
const HABIT_CATEGORIES = new Set(['מזון', 'מסעדות', 'קניות'])

const isExpense = (r, incomeSet) => r.amount < 0 && !incomeSet.has(r.category)
const isIncome  = (r, incomeSet) => r.amount > 0 && incomeSet.has(r.category)

// ---------------------------------------------------------------------------
// 1. Representative month
// ---------------------------------------------------------------------------

/** Income / expenses / net per month of the window. */
export function monthlyTotals(rows, months, incomeSet) {
  const map = new Map(months.map(m => [m, { month: m, income: 0, expenses: 0, net: 0 }]))
  for (const r of rows) {
    const t = map.get(r.month)
    if (!t) continue
    if (isIncome(r, incomeSet)) t.income += r.amount
    else if (isExpense(r, incomeSet)) t.expenses += -r.amount
  }
  for (const t of map.values()) t.net = t.income - t.expenses
  return months.map(m => map.get(m))
}

/**
 * Where the income comes from, payer by payer, and what each one contributes to
 * a TYPICAL month. Salaries land on the 1st one month and the 31st the next, so
 * a raw monthly series shows months with zero or two salaries; per payer we
 * therefore look at the payments themselves:
 *   'regular'   about one payment a month (N−1 … N+1 payments in N months — the
 *               +1 is a payment that slid across a month boundary) of a stable
 *               amount → typical = the median payment, once a month
 *   'irregular' anything else (self-employment, occasional or variable credits)
 *               → total ÷ N
 *   'one-off'   a single payment in a window of ≥4 months → NOT part of a
 *               typical month; listed separately so it can be reviewed
 *               (often a transfer from one's own account filed as income).
 * typicalIncome = Σ typical over the non-one-off payers.
 *
 * Bank transfer descriptions carry a free-text memo ("העברה מ… — משכורת",
 * "… — מקדמה"), so payers are clustered by a shared prefix of ≥3 words.
 */
export function incomeComposition(rows, months, incomeSet) {
  const N = months.length
  const payers = new Map()
  const clusterKey = k => {
    const words = k.split(' ')
    for (const existing of payers.keys()) {
      const ew = existing.split(' ')
      let i = 0
      while (i < words.length && i < ew.length && words[i] === ew[i]) i++
      if (i >= 3) return existing
    }
    return k
  }
  for (const r of rows) {
    if (!isIncome(r, incomeSet)) continue
    const raw = normalizeMerchant(r.description)
    if (!raw) continue
    const key = clusterKey(raw)
    if (!payers.has(key)) payers.set(key, { key, descriptions: new Map(), payments: [], months: new Set(), total: 0 })
    const p = payers.get(key)
    p.payments.push(r.amount); p.months.add(r.month); p.total += r.amount
    p.descriptions.set(r.description, (p.descriptions.get(r.description) || 0) + 1)
  }
  const grand = [...payers.values()].reduce((s, p) => s + p.total, 0)
  const sources = [...payers.values()].map(p => {
    const n = p.payments.length
    const med = median(p.payments)
    const mad = med > 0 ? median(p.payments.map(v => Math.abs(v - med))) / med : 0
    let kind, typical
    if (n === 1 && N >= 4) { kind = 'one-off'; typical = 0 }
    else if (n >= N - 1 && n <= N + 1 && mad <= 0.25) { kind = 'regular'; typical = med }
    else { kind = 'irregular'; typical = p.total / N }
    return {
      key: p.key,
      description: [...p.descriptions.entries()].sort((a, b) => b[1] - a[1])[0][0],
      payments: n, monthsPresent: p.months.size, total: p.total,
      medianPayment: median(p.payments),
      // A regular payer with more payments than months → a payment slid across a
      // month boundary (paid on the 31st / 1st) — the chart's zig-zag, not real change.
      jitter: kind === 'regular' && n > p.months.size,
      kind, typical, share: grand > 0 ? p.total / grand : 0,
    }
  }).sort((a, b) => b.total - a.total)
  const oneOff = sources.filter(s => s.kind === 'one-off')
  return {
    sources,
    typicalIncome: sources.reduce((s, p) => s + p.typical, 0),
    oneOff: { items: oneOff, total: oneOff.reduce((s, p) => s + p.total, 0) },
    hasJitter: sources.some(s => s.jitter),
  }
}

/**
 * The "normal" month. Income is the per-payer typical income (see
 * incomeComposition — immune to salary timing and one-off credits); expenses
 * are the median month (a single unusual month doesn't move it); the mean is
 * reported for comparison.
 *
 * net = typical income − median expenses (positive = surplus, negative = deficit).
 * Volatility is the coefficient of variation of monthly expenses; outliers are
 * months more than 20% away from the median. pattern says whether the noise is
 * one exceptional month ('one-off') or a different surprise every month
 * ('every-month').
 */
export function representativeMonth(totals, composition = null) {
  const N = totals.length
  const inc = totals.map(t => t.income), exp = totals.map(t => t.expenses), net = totals.map(t => t.net)
  const med = { income: median(inc), expenses: median(exp) }
  med.net = med.income - med.expenses
  const avg = { income: mean(inc), expenses: mean(exp), net: mean(net) }
  const income = composition ? composition.typicalIncome : med.income
  const expenses = med.expenses

  const cv = avg.expenses > 0 ? stdev(exp) / avg.expenses : 0
  const outliers = totals
    .filter(t => med.expenses > 0 && Math.abs(t.expenses - med.expenses) / med.expenses > 0.2)
    .map(t => ({ month: t.month, expenses: t.expenses, deviationPct: (t.expenses - med.expenses) / med.expenses }))
    .sort((a, b) => Math.abs(b.deviationPct) - Math.abs(a.deviationPct))
  const level = cv < 0.12 ? 'stable' : cv < 0.25 ? 'moderate' : 'volatile'
  const pattern = outliers.length === 0 ? 'stable'
                : outliers.length <= Math.max(1, Math.floor(N / 4)) ? 'one-off'
                : 'every-month'

  const byNet = [...totals].sort((a, b) => a.net - b.net)
  return {
    enough: N >= 3,
    monthsCount: N,
    months: totals,
    income, expenses, net: income - expenses,
    median: med,
    mean: avg,
    annualizedNet: (income - expenses) * 12,
    netRange: { p25: quantile(net, 0.25), p75: quantile(net, 0.75) },
    incomeSources: composition ? composition.sources : [],
    oneOffIncome: composition ? composition.oneOff : { items: [], total: 0 },
    incomeJitter: composition ? composition.hasJitter : false,
    best:  byNet.length ? { month: byNet[byNet.length - 1].month, net: byNet[byNet.length - 1].net } : null,
    worst: byNet.length ? { month: byNet[0].month, net: byNet[0].net } : null,
    volatility: { cv, level, pattern, outliers },
  }
}

// ---------------------------------------------------------------------------
// 2. Recurring charges + spending structure
// ---------------------------------------------------------------------------

/**
 * Detect recurring ("fixed") charges at the merchant level. A merchant is
 * recurring when it is charged at most ~twice a month and either
 *   - 'monthly':  appears in (almost) every month of the window — amounts may
 *                 vary (electricity), or
 *   - 'periodic': appears in at least half the months (≥3), evenly spaced, with
 *                 stable amounts (bi-monthly water / arnona / gas).
 * Food, restaurant and shopping merchants only qualify with near-identical
 * amounts (a real subscription) — eating at the same place monthly is a habit,
 * not an obligation. Installment charges are left out (committed debt, counted
 * separately).
 *
 * Also reports changes: recurring merchants that vanished in the last two months
 * ('gone'), merchants that started in the last three months ('new'), and stable
 * merchants whose last charge is ≥10% above their usual amount ('increased').
 */
export function detectRecurring(rows, months, incomeSet) {
  const N = months.length
  const groups = new Map()
  for (const r of rows) {
    if (!isExpense(r, incomeSet) || r.type === 'installment') continue
    const key = normalizeMerchant(r.description)
    if (!key) continue
    if (!groups.has(key)) {
      groups.set(key, { key, descriptions: new Map(), categories: new Map(), byMonth: new Map(), count: 0, total: 0 })
    }
    const g = groups.get(key)
    g.count++
    g.total += -r.amount
    g.byMonth.set(r.month, (g.byMonth.get(r.month) || 0) + -r.amount)
    g.descriptions.set(r.description, (g.descriptions.get(r.description) || 0) + 1)
    g.categories.set(r.category, (g.categories.get(r.category) || 0) + 1)
  }

  const mostCommon = map => [...map.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || ''
  const merchants = []
  const changes = { new: [], gone: [], increased: [] }
  if (N < 3) return { enough: false, merchants, changes, monthlyTotal: 0, byMonth: new Map() }

  const lastTwo = months.slice(-2), lastThree = months.slice(-3)
  const before2 = months.slice(0, -2), before3 = months.slice(0, -3)

  for (const g of groups.values()) {
    const present = [...g.byMonth.keys()]
    const monthsPresent = present.length
    const perMonthCount = g.count / monthsPresent
    const sums = [...g.byMonth.values()]
    const typical = median(sums)
    const mad = typical > 0 ? median(sums.map(v => Math.abs(v - typical))) / typical : 0
    const category = mostCommon(g.categories)
    const habit = HABIT_CATEGORIES.has(category)
    // Regular spacing: a bi-monthly / quarterly bill lands every k months; a shop
    // visited "most months" doesn't.
    const idx = present.map(m => months.indexOf(m)).sort((a, b) => a - b)
    const gaps = idx.slice(1).map((v, i) => v - idx[i])
    const regular = gaps.length > 0 && Math.max(...gaps) - Math.min(...gaps) <= 1
    const monthly  = monthsPresent >= Math.max(3, N - 1) && perMonthCount <= 2 && mad <= (habit ? 0.1 : 0.5)
    const periodic = !monthly && monthsPresent >= 3 && monthsPresent >= N / 2 && perMonthCount <= 1.5
                     && mad <= (habit ? 0.1 : 0.2) && regular
    const base = {
      key: g.key,
      description: mostCommon(g.descriptions),
      category,
      monthsPresent, count: g.count, total: g.total, typical,
      avgPerMonth: g.total / N,
    }

    if (monthly || periodic) {
      merchants.push({ ...base, kind: monthly ? 'monthly' : 'periodic' })
      // Price increase: a stable merchant whose latest charge jumped.
      if (monthly && mad <= 0.15 && N >= 4) {
        const lastMonth = present.sort()[present.length - 1]
        const last = g.byMonth.get(lastMonth)
        const earlier = median(present.filter(m => m !== lastMonth).map(m => g.byMonth.get(m)))
        if (earlier > 0 && last >= earlier * 1.1 && last - earlier >= 20) {
          changes.increased.push({ ...base, from: earlier, to: last, month: lastMonth })
        }
      }
    }

    if (N >= 5) {
      // Gone: was recurring in the earlier months (stable amount — a subscription,
      // not a shop visited most months), absent in the last two.
      const earlierPresent = before2.filter(m => g.byMonth.has(m)).length
      const wasRecurring = earlierPresent >= Math.max(3, before2.length - 1) && perMonthCount <= 2 && mad <= (habit ? 0.1 : 0.3)
      if (wasRecurring && lastTwo.every(m => !g.byMonth.has(m))) {
        changes.gone.push({ ...base, lastSeen: present.sort()[present.length - 1] })
      }
    }
    if (N >= 6) {
      // New: present in each of the last three months, never before.
      const inLastThree = lastThree.every(m => g.byMonth.has(m))
      const neverBefore = before3.every(m => !g.byMonth.has(m))
      if (inLastThree && neverBefore && perMonthCount <= 2 && mad <= (habit ? 0.1 : 0.3)) {
        changes.new.push({ ...base, since: lastThree[0] })
      }
    }
  }

  merchants.sort((a, b) => b.avgPerMonth - a.avgPerMonth)
  for (const list of Object.values(changes)) list.sort((a, b) => b.avgPerMonth - a.avgPerMonth)

  // Fixed amount per month = the recurring merchants' charges in that month.
  const byMonth = new Map(months.map(m => [m, 0]))
  const recurringKeys = new Set(merchants.map(m => m.key))
  for (const g of groups.values()) {
    if (!recurringKeys.has(g.key)) continue
    for (const [m, v] of g.byMonth) byMonth.set(m, (byMonth.get(m) || 0) + v)
  }

  return {
    enough: true,
    merchants,
    recurringKeys,
    changes,
    monthlyTotal: merchants.reduce((s, m) => s + m.avgPerMonth, 0),
    byMonth,
  }
}

/**
 * Structural vs behavioural. Per month: fixed = recurring merchants + installment
 * charges; variable = everything else. Representative values are medians.
 *
 *   leftAfterFixed = income − fixed          (what a normal month leaves for living)
 *   variable       = expenses − fixed
 *   gap            = income − expenses       (negative = deficit)
 *
 * verdict: 'no-income'  no income recorded — can't judge
 *          'balanced'   a normal month ends with money left
 *          'structural' fixed obligations alone take ≥60% of income, or leave
 *                       nothing for variable spending
 *          'behavioral' fixed leave room, but variable spending exceeds it
 */
export function spendingStructure(rows, months, incomeSet, totals, recurring, typicalIncome = null) {
  const N = months.length
  const fixedByMonth = new Map(months.map(m => [m, { recurring: recurring.byMonth.get(m) || 0, installments: 0 }]))
  const variableByCat = new Map()
  for (const r of rows) {
    if (!isExpense(r, incomeSet)) continue
    const f = fixedByMonth.get(r.month)
    if (!f) continue
    if (r.type === 'installment') { f.installments += -r.amount; continue }
    if (recurring.recurringKeys?.has(normalizeMerchant(r.description))) continue
    variableByCat.set(r.category, (variableByCat.get(r.category) || 0) + -r.amount)
  }
  const series = months.map(m => {
    const t = totals.find(x => x.month === m)
    const f = fixedByMonth.get(m)
    const fixed = f.recurring + f.installments
    return { month: m, income: t.income, expenses: t.expenses, recurring: f.recurring, installments: f.installments, fixed, variable: Math.max(0, t.expenses - fixed) }
  })

  // Income: the per-payer typical income when given (see incomeComposition —
  // salary timing and one-off credits don't distort it), else the median month.
  const income   = typicalIncome != null ? typicalIncome : median(series.map(s => s.income))
  const expenses = median(series.map(s => s.expenses))
  const recurringMed    = median(series.map(s => s.recurring))
  const installmentsMed = median(series.map(s => s.installments))
  const fixed = recurringMed + installmentsMed
  const variable = Math.max(0, expenses - fixed)
  const leftAfterFixed = income - fixed
  const gap = income - expenses
  const fixedShare = income > 0 ? fixed / income : null

  let verdict
  if (income <= 0) verdict = 'no-income'
  else if (gap >= 0) verdict = 'balanced'
  else if (leftAfterFixed <= 0 || fixedShare >= 0.6) verdict = 'structural'
  else verdict = 'behavioral'

  const topVariable = [...variableByCat.entries()]
    .map(([category, total]) => ({ category, avgPerMonth: total / N }))
    .sort((a, b) => b.avgPerMonth - a.avgPerMonth)
    .slice(0, 5)

  return {
    enough: N >= 3,
    income, expenses,
    fixed: { recurring: recurringMed, installments: installmentsMed, total: fixed, share: fixedShare },
    variable: { total: variable, share: income > 0 ? variable / income : null, topCategories: topVariable },
    leftAfterFixed, gap, verdict,
    heavyFixed: fixedShare != null && fixedShare >= 0.5,
    series,
  }
}

// ---------------------------------------------------------------------------
// 3. Gap drivers
// ---------------------------------------------------------------------------

/**
 * Per category: monthly average, share of spending, how many charges a month
 * and the average charge — so "many small" (≥10 charges/month) reads
 * differently from "few large" (≤3). With a budget: the average monthly
 * overshoot. `top` are the 4 biggest categories; `overBudget` the 4 biggest
 * overshoots.
 */
export function gapDrivers(rows, months, incomeSet, limits) {
  const N = months.length
  const cats = new Map()
  let all = 0
  for (const r of rows) {
    if (!isExpense(r, incomeSet)) continue
    if (!cats.has(r.category)) cats.set(r.category, { category: r.category, total: 0, count: 0, byMonth: new Map() })
    const c = cats.get(r.category)
    c.total += -r.amount; c.count++; all += -r.amount
    c.byMonth.set(r.month, (c.byMonth.get(r.month) || 0) + -r.amount)
  }
  const rowsOut = [...cats.values()].map(c => {
    let budgetMonths = 0, budgetSum = 0, overSum = 0
    for (const m of months) {
      const lim = limits.get(`${c.category}|${m}`)
      if (lim == null) continue
      budgetMonths++; budgetSum += lim
      overSum += Math.max(0, (c.byMonth.get(m) || 0) - lim)
    }
    const countPerMonth = c.count / N
    return {
      category: c.category,
      avgPerMonth: c.total / N,
      share: all > 0 ? c.total / all : 0,
      countPerMonth,
      avgTicket: c.count ? c.total / c.count : 0,
      pattern: countPerMonth >= 10 ? 'many-small' : countPerMonth <= 3 ? 'few-large' : 'mixed',
      budgetAvg: budgetMonths ? budgetSum / budgetMonths : null,
      overAvg: budgetMonths ? overSum / budgetMonths : null,
      monthsOver: budgetMonths ? months.filter(m => {
        const lim = limits.get(`${c.category}|${m}`); return lim != null && (c.byMonth.get(m) || 0) > lim
      }).length : null,
      budgetMonths,
    }
  }).sort((a, b) => b.avgPerMonth - a.avgPerMonth)

  return {
    enough: N >= 3,
    totalPerMonth: all / N,
    categories: rowsOut,
    top: rowsOut.slice(0, 4),
    overBudget: rowsOut.filter(r => (r.overAvg || 0) > 0).sort((a, b) => b.overAvg - a.overAvg).slice(0, 4),
  }
}

// ---------------------------------------------------------------------------
// 4. Budget realism
// ---------------------------------------------------------------------------

/**
 * For every category budgeted in at least half the window months: the current
 * limit, the median and 75th-percentile monthly spend, how many months went
 * over, and a verdict:
 *   'wishful'   over in ≥2/3 of months and the median is ≥10% above the limit
 *               → suggested = the median (rounded to 50)
 *   'loose'     over in ≤1/3 of months and the median is below 70% of the limit
 *               → suggested = the 75th percentile (rounded to 50)
 *   'realistic' everything else
 * planningGap = Σ over wishful categories of (median − limit): how much a month
 * the plan is understating reality.
 */
export function budgetRealism(rows, months, incomeSet, limits) {
  const N = months.length
  const spent = new Map()   // 'cat|month' -> spent
  const cats = new Set()
  for (const r of rows) {
    if (!isExpense(r, incomeSet)) continue
    const k = `${r.category}|${r.month}`
    spent.set(k, (spent.get(k) || 0) + -r.amount)
  }
  for (const k of limits.keys()) cats.add(k.split('|')[0])

  const out = []
  for (const category of cats) {
    if (incomeSet.has(category)) continue   // an income target isn't a spending budget
    const budgeted = months.filter(m => limits.has(`${category}|${m}`))
    if (budgeted.length < Math.ceil(N / 2)) continue
    const series = budgeted.map(m => spent.get(`${category}|${m}`) || 0)
    const monthsOver = budgeted.filter(m => (spent.get(`${category}|${m}`) || 0) > limits.get(`${category}|${m}`)).length
    const budget = limits.get(`${category}|${budgeted[budgeted.length - 1]}`)   // the current limit
    const med = median(series), p75 = quantile(series, 0.75)
    const overShare = monthsOver / budgeted.length
    let verdict = 'realistic', suggested = null
    if (overShare >= 2 / 3 && med >= budget * 1.1) { verdict = 'wishful'; suggested = round50(med) }
    else if (overShare <= 1 / 3 && med < budget * 0.7 && budget > 0) { verdict = 'loose'; suggested = round50(p75) }
    out.push({ category, budget, median: med, p75, monthsOver, monthsBudgeted: budgeted.length, ratio: budget > 0 ? med / budget : null, verdict, suggested })
  }
  out.sort((a, b) => (b.median - b.budget) - (a.median - a.budget))
  const wishful = out.filter(r => r.verdict === 'wishful')
  return {
    enough: N >= 3 && out.length > 0,
    rows: out,
    summary: {
      wishful: wishful.length,
      loose: out.filter(r => r.verdict === 'loose').length,
      realistic: out.filter(r => r.verdict === 'realistic').length,
      planningGap: wishful.reduce((s, r) => s + (r.median - r.budget), 0),
    },
  }
}

// ---------------------------------------------------------------------------
// 5. Progress
// ---------------------------------------------------------------------------

/**
 * Recent half of the window vs the half before it (6 months → 3 vs 3). Compares
 * average expenses, income, net, budget breaches per month and the share of
 * spending left in the catch-all category (a proxy for bookkeeping accuracy).
 * Movers are the categories that changed most (≥15% and ≥ max(100, 1% of
 * monthly spend)). One-off income (see incomeComposition) is left out of the
 * period income so a single transfer can't masquerade as "improvement".
 */
export function progress(rows, months, incomeSet, limits, totals, oneOffKeys = new Set()) {
  const N = months.length
  if (N < 4) return { enough: false, monthsCount: N }
  const half = Math.floor(N / 2)
  const recentMonths = months.slice(-half), previousMonths = months.slice(0, N - half)

  const spent = new Map()   // 'cat|month' -> spent
  const oneOffByMonth = new Map()
  for (const r of rows) {
    if (isIncome(r, incomeSet) && oneOffKeys.has(normalizeMerchant(r.description))) {
      oneOffByMonth.set(r.month, (oneOffByMonth.get(r.month) || 0) + r.amount)
      continue
    }
    if (!isExpense(r, incomeSet)) continue
    const k = `${r.category}|${r.month}`
    spent.set(k, (spent.get(k) || 0) + -r.amount)
  }
  const categories = new Set([...spent.keys()].map(k => k.split('|')[0]))

  function period(ms) {
    const ts = totals.filter(t => ms.includes(t.month))
    const expenses = mean(ts.map(t => t.expenses))
    const income = mean(ts.map(t => t.income - (oneOffByMonth.get(t.month) || 0)))
    let breaches = 0, other = 0
    for (const m of ms) {
      other += spent.get(`${OTHER_CATEGORY}|${m}`) || 0
      for (const c of categories) {
        const lim = limits.get(`${c}|${m}`)
        if (lim != null && (spent.get(`${c}|${m}`) || 0) > lim) breaches++
      }
    }
    const byCat = {}
    for (const c of categories) byCat[c] = mean(ms.map(m => spent.get(`${c}|${m}`) || 0))
    return { months: ms, expenses, income, net: income - expenses, breachesPerMonth: breaches / ms.length, otherShare: expenses > 0 ? (other / ms.length) / expenses : 0, byCat }
  }
  const recent = period(recentMonths), previous = period(previousMonths)

  const minAbs = Math.max(100, 0.01 * previous.expenses)
  const movers = [...categories].map(c => {
    const from = previous.byCat[c] || 0, to = recent.byCat[c] || 0
    return { category: c, from, to, delta: to - from, pct: from > 0 ? (to - from) / from : (to > 0 ? 1 : 0) }
  }).filter(mv => Math.abs(mv.delta) >= minAbs && Math.abs(mv.pct) >= 0.15)
  const up = movers.filter(mv => mv.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 3)
  const down = movers.filter(mv => mv.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 3)

  const netDelta = recent.net - previous.net
  const expensesPct = previous.expenses > 0 ? (recent.expenses - previous.expenses) / previous.expenses : 0
  const scale = Math.max(previous.income, previous.expenses, 1)
  let verdict = 'flat'
  if (netDelta >= 0.03 * scale || expensesPct <= -0.05) verdict = 'improving'
  else if (netDelta <= -0.03 * scale || expensesPct >= 0.05) verdict = 'worsening'

  const strip = p => ({ months: p.months, expenses: p.expenses, income: p.income, net: p.net, breachesPerMonth: p.breachesPerMonth, otherShare: p.otherShare })
  return {
    enough: true,
    recent: strip(recent), previous: strip(previous),
    delta: {
      expenses: recent.expenses - previous.expenses, expensesPct,
      income: recent.income - previous.income,
      net: netDelta,
      breachesPerMonth: recent.breachesPerMonth - previous.breachesPerMonth,
      otherShare: recent.otherShare - previous.otherShare,
    },
    movers: { up, down },
    verdict,
  }
}

// ---------------------------------------------------------------------------
// 6. Periodic / irregular expenses
// ---------------------------------------------------------------------------

/**
 * Expenses that don't belong in a monthly budget but hit anyway: a merchant seen
 * in at most two months of the window (one, if the window is short) with a big
 * charge — insurance, holidays, car service, school, a repair. Their total spread
 * over the window is the monthly set-aside the family should plan for.
 * "Big" scales with the family: max(300, 1.5% of average monthly spending).
 * Lumpy categories (monthly spend swinging ≥60% around its mean) are listed too.
 */
export function periodicExpenses(rows, months, incomeSet, recurring, avgMonthlyExpenses) {
  const N = months.length
  const bigThreshold = Math.max(300, 0.015 * avgMonthlyExpenses)
  const maxMonths = N >= 6 ? 2 : 1

  const groups = new Map()
  const catByMonth = new Map()
  for (const r of rows) {
    if (!isExpense(r, incomeSet)) continue
    const amt = -r.amount
    if (!catByMonth.has(r.category)) catByMonth.set(r.category, new Map())
    const cm = catByMonth.get(r.category); cm.set(r.month, (cm.get(r.month) || 0) + amt)
    if (r.type === 'installment') continue
    const key = normalizeMerchant(r.description)
    if (!key || recurring.recurringKeys?.has(key)) continue
    if (!groups.has(key)) groups.set(key, { key, description: r.description, category: r.category, total: 0, count: 0, months: new Set(), maxTxn: 0, txns: [] })
    const g = groups.get(key)
    g.total += amt; g.count++; g.months.add(r.month); g.maxTxn = Math.max(g.maxTxn, amt)
    g.txns.push({ id: r.id, date: r.date, description: r.description, amount: r.amount, category: r.category })
  }

  const items = [...groups.values()]
    .filter(g => g.months.size <= maxMonths && (g.maxTxn >= bigThreshold || g.total >= 2 * bigThreshold))
    .map(g => ({ key: g.key, description: g.description, category: g.category, total: g.total, count: g.count, months: [...g.months].sort(), maxTxn: g.maxTxn, txns: g.txns.sort((a, b) => b.date.localeCompare(a.date)) }))
    .sort((a, b) => b.total - a.total)
  const total = items.reduce((s, i) => s + i.total, 0)

  const byCategory = new Map()
  for (const i of items) byCategory.set(i.category, (byCategory.get(i.category) || 0) + i.total)

  const lumpy = [...catByMonth.entries()].map(([category, cm]) => {
    const series = months.map(m => cm.get(m) || 0)
    const avg = mean(series)
    return { category, avgPerMonth: avg, cv: avg > 0 ? stdev(series) / avg : 0, max: Math.max(...series) }
  }).filter(c => c.cv >= 0.6 && c.avgPerMonth >= 0.02 * avgMonthlyExpenses)
    .sort((a, b) => b.avgPerMonth - a.avgPerMonth)

  return {
    enough: N >= 4,
    threshold: bigThreshold,
    items,
    total,
    perMonth: N ? total / N : 0,
    provision: N ? round50(total / N) : 0,
    shareOfExpenses: avgMonthlyExpenses > 0 && N ? (total / N) / avgMonthlyExpenses : 0,
    byCategory: [...byCategory.entries()].map(([category, t]) => ({ category, total: t })).sort((a, b) => b.total - a.total),
    lumpyCategories: lumpy,
    coverage: { months, from: months[0] || null, to: months[months.length - 1] || null },
  }
}

// ---------------------------------------------------------------------------
// 7. Installments and debts
// ---------------------------------------------------------------------------

/**
 * Credit-card installment plans reconstructed from their monthly charges. A plan
 * is the same merchant + total installments + original purchase amount; each
 * month's charge carries its installment number, so the latest one tells how
 * many are paid and how many remain. Plans not seen for 3+ months while still
 * "open" are stale (cancelled, or the card was excluded) and are left out of
 * the projection.
 *
 * Returns the active plans, a 12-month forward schedule of committed amounts,
 * what ends within 6 months (and the money it frees), the plans opened inside
 * the window, and any manually-tracked liabilities from the assets sheet.
 */
export function installmentsInsight(db, { now = new Date(), windowMonths = [], incomeMedian = 0 } = {}) {
  const current = monthKey(now)
  const rows = loadInstallmentRows(db)
  const plans = new Map()
  const unknown = { count: 0, total: 0 }     // installments without a parsed number/total
  for (const r of rows) {
    if (r.installment_total == null || r.installment_number == null) {
      if (windowMonths.includes(r.month)) { unknown.count++; unknown.total += Math.abs(r.amount) }
      continue
    }
    const key = `${normalizeMerchant(r.description)}|${r.installment_total}|${Math.round(Math.abs(r.original_amount || 0))}`
    if (!plans.has(key)) plans.set(key, { key, description: r.description, category: r.category, total: r.installment_total, originalAmount: Math.abs(r.original_amount || 0), charges: [] })
    plans.get(key).charges.push({ month: r.month, number: r.installment_number, amount: Math.abs(r.amount) })
  }

  const staleBefore = addMonths(current, -2)   // last seen before this → stale
  const out = []
  for (const p of plans.values()) {
    p.charges.sort((a, b) => a.number - b.number || a.month.localeCompare(b.month))
    const latest = p.charges[p.charges.length - 1]
    const first = p.charges[0]
    // Two identical purchases (same merchant, total and price) land in one group;
    // a repeated installment number reveals how many parallel plans there are.
    const perNumber = new Map()
    for (const c of p.charges) perNumber.set(c.number, (perNumber.get(c.number) || 0) + 1)
    const multiplicity = Math.max(...perNumber.values())
    const perMonth = median(p.charges.map(c => c.amount)) * multiplicity
    const remaining = Math.max(0, p.total - latest.number)
    const startMonth = addMonths(first.month, -(first.number - 1))
    const endMonth = addMonths(latest.month, remaining)
    const stale = remaining > 0 && latest.month < staleBefore
    const observedMonths = new Set(p.charges.map(c => c.month))
    out.push({
      description: p.description, category: p.category,
      total: p.total, originalAmount: p.originalAmount * multiplicity, perMonth, multiplicity,
      paid: latest.number, remaining, remainingAmount: perMonth * remaining,
      startMonth, endMonth, lastSeen: latest.month,
      status: remaining === 0 ? 'finished' : stale ? 'stale' : 'active',
      observedMonths,
    })
  }

  const active = out.filter(p => p.status === 'active')
  const schedule = []
  for (let i = 0; i < 12; i++) {
    const m = addMonths(current, i)
    let amount = 0, ending = 0
    for (const p of active) {
      const observed = p.observedMonths.has(m)
      const projected = m > p.lastSeen && m <= p.endMonth
      if (observed || projected) amount += p.perMonth
      if (p.endMonth === m) ending++
    }
    schedule.push({ month: m, amount, ending })
  }
  const monthlyBurden = schedule[0].amount
  const endingSoon = active.filter(p => p.endMonth <= addMonths(current, 6)).sort((a, b) => a.endMonth.localeCompare(b.endMonth))
  const newInWindow = out.filter(p => windowMonths.includes(p.startMonth))

  const liabilities = db.prepare(`
    SELECT f.id, f.institution, f.asset_type, f.label, f.currency,
           (SELECT s.balance FROM asset_snapshots s WHERE s.asset_id = f.id ORDER BY s.snapshot_date DESC LIMIT 1) AS balance,
           (SELECT s.snapshot_date FROM asset_snapshots s WHERE s.asset_id = f.id ORDER BY s.snapshot_date DESC LIMIT 1) AS asOf
    FROM financial_assets f
    WHERE f.kind = 'liability' AND f.archived = 0
    ORDER BY f.sort_order, f.id
  `).all()

  const strip = p => { const { observedMonths, ...rest } = p; return rest }
  return {
    enough: true,
    currentMonth: current,
    plans: active.map(strip).sort((a, b) => b.perMonth - a.perMonth),
    stalePlans: out.filter(p => p.status === 'stale').map(strip),
    finishedRecently: out.filter(p => p.status === 'finished' && p.endMonth >= addMonths(current, -3)).map(strip),
    unknown,
    monthlyBurden,
    shareOfIncome: incomeMedian > 0 ? monthlyBurden / incomeMedian : null,
    remainingDebt: active.reduce((s, p) => s + p.remainingAmount, 0),
    schedule,
    endingSoon: endingSoon.map(strip),
    newInWindow: { count: newInWindow.length, total: newInWindow.reduce((s, p) => s + p.originalAmount, 0) },
    liabilities,
    liabilitiesTotal: liabilities.filter(l => l.currency === 'ILS' && l.balance != null).reduce((s, l) => s + l.balance, 0),
  }
}

// ---------------------------------------------------------------------------
// Everything together
// ---------------------------------------------------------------------------

/**
 * Compute all seven insights over the last `monthsBack` complete months
 * (or 'all'). `now` is injectable for tests.
 */
export function computeInsights(db = getDb(), { monthsBack = 6, now = new Date() } = {}) {
  const months = completeMonths(db, monthsBack, now)
  const incomeSet = new Set(incomeCategoryNames(db))
  const rows = loadWindowRows(db, months)
  const limits = effectiveLimitsByMonth(db, months)

  const totals = monthlyTotals(rows, months, incomeSet)
  const composition = incomeComposition(rows, months, incomeSet)
  const representative = representativeMonth(totals, composition)
  const recurring = detectRecurring(rows, months, incomeSet)
  const structure = spendingStructure(rows, months, incomeSet, totals, recurring, composition.typicalIncome)
  const drivers = gapDrivers(rows, months, incomeSet, limits)
  const realism = budgetRealism(rows, months, incomeSet, limits)
  const prog = progress(rows, months, incomeSet, limits, totals, new Set(composition.oneOff.items.map(i => i.key)))
  const periodic = periodicExpenses(rows, months, incomeSet, recurring, representative.mean.expenses)
  const installments = installmentsInsight(db, { now, windowMonths: months, incomeMedian: representative.income })

  const { recurringKeys, byMonth, ...recurringOut } = recurring
  return {
    window: { months, from: months[0] || null, to: months[months.length - 1] || null, count: months.length, currentMonth: monthKey(now), requested: monthsBack },
    representative,
    structure: { ...structure, recurring: { ...recurringOut, merchants: recurringOut.merchants.slice(0, 40) } },
    drivers,
    budgetRealism: realism,
    progress: prog,
    periodic: { ...periodic, items: periodic.items.slice(0, 30) },
    installments,
  }
}

export { round50, round1 }
