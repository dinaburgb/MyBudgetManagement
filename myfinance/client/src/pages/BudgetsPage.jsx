import { useState, useEffect } from 'react'
import { ChevronUp, ChevronDown, X } from 'lucide-react'
import axios from 'axios'
import { ils } from '../colors.js'
import { useCategories } from '../CategoriesContext.jsx'
import TxnRow from '../TxnRow.jsx'

// Build a list of month options: 12 months back through 1 month ahead.
const HE_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר']
function monthOptions() {
  const now = new Date()
  const out = []
  for (let i = -1; i <= 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    out.push({ key, label: `${HE_MONTHS[d.getMonth()]} ${d.getFullYear()}` })
  }
  return out
}
function currentMonthKey() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function monthLabel(key) {
  if (!key) return ''
  const [y, m] = key.split('-').map(Number)
  return `${HE_MONTHS[m - 1]} ${y}`
}

// Ring color by how much of the monthly budget is used.
function toneColor(ratio) {
  if (ratio >= 1) return '#ef4444'    // red — over budget
  if (ratio >= 0.8) return '#f59e0b'  // amber — getting close
  return '#22c55e'                    // green — comfortable
}
const TRACK = '#374151'  // gray-700

/** A compact donut tile for one category. */
function BudgetTile({ row, catId, isFirst, isLast, onMove, onOpen }) {
  const { colorFor } = useCategories()
  const limit = row.limit
  const ratio = limit ? row.spent / limit : 0
  const pct = Math.min(ratio * 100, 100)
  const over = limit != null && row.remaining < 0

  // Donut geometry.
  const R = 40, C = 2 * Math.PI * R
  const dash = (pct / 100) * C
  const ring = limit != null ? toneColor(ratio) : TRACK

  return (
    <div className="relative bg-gray-900 rounded-xl p-3 flex flex-col items-center">
      {/* Reorder arrows */}
      {catId != null && (
        <div className="absolute top-2 right-2 flex flex-col gap-0.5">
          <button
            onClick={() => onMove(catId, 'up')}
            disabled={isFirst}
            className="text-gray-600 hover:text-white disabled:opacity-20 disabled:hover:text-gray-600 transition-colors"
            title="הזז למעלה"
          >
            <ChevronUp className="w-4 h-4" />
          </button>
          <button
            onClick={() => onMove(catId, 'down')}
            disabled={isLast}
            className="text-gray-600 hover:text-white disabled:opacity-20 disabled:hover:text-gray-600 transition-colors"
            title="הזז למטה"
          >
            <ChevronDown className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Donut — click to edit */}
      <button onClick={() => onOpen(row)} className="relative w-28 h-28 mt-1" title="ערוך תקציב">
        <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
          <circle cx="50" cy="50" r={R} fill="none" stroke={TRACK} strokeWidth="9" />
          {limit != null && pct > 0 && (
            <circle
              cx="50" cy="50" r={R} fill="none" stroke={ring} strokeWidth="9"
              strokeDasharray={`${dash} ${C - dash}`} strokeLinecap="round"
              className="transition-all"
            />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-bold text-white leading-none">{ils(row.spent)}</span>
          {limit != null ? (
            <span className={`text-xs mt-1 ${over ? 'text-red-400' : 'text-gray-400'}`}>
              {over ? `חריגה ${ils(-row.remaining)}` : `נותרו ${ils(row.remaining)}`}
            </span>
          ) : (
            <span className="text-xs mt-1 text-gray-600">אין תקציב</span>
          )}
        </div>
      </button>

      {/* Category name */}
      <div className="flex items-center gap-1.5 mt-2 text-center">
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: colorFor(row.category) }} />
        <span className="text-sm text-white font-medium leading-tight">{row.category}</span>
      </div>

      {/* Budget + accumulated balance */}
      {limit != null && (
        <div className="mt-1 text-center text-xs leading-snug">
          <div className="text-gray-500">תקציב {ils(limit)}</div>
          {row.carryover != null && (
            <div className={row.carryover >= 0 ? 'text-green-400' : 'text-red-400'}>
              מצטבר {row.carryover >= 0 ? '+' : '−'}{ils(Math.abs(row.carryover))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** A compact donut tile for one income category: earned vs expected target. */
function IncomeTile({ row, catId, isFirst, isLast, onMove, onOpen }) {
  const { colorFor } = useCategories()
  const target = row.limit
  const ratio = target ? Math.min(row.earned / target, 1) : 0
  const pct = ratio * 100
  const reached = target != null && row.earned >= target

  const R = 40, C = 2 * Math.PI * R
  const dash = (pct / 100) * C

  return (
    <div className="relative bg-gray-900 rounded-xl p-3 flex flex-col items-center">
      {catId != null && (
        <div className="absolute top-2 right-2 flex flex-col gap-0.5">
          <button onClick={() => onMove(catId, 'up')} disabled={isFirst}
            className="text-gray-600 hover:text-white disabled:opacity-20 disabled:hover:text-gray-600 transition-colors" title="הזז למעלה">
            <ChevronUp className="w-4 h-4" />
          </button>
          <button onClick={() => onMove(catId, 'down')} disabled={isLast}
            className="text-gray-600 hover:text-white disabled:opacity-20 disabled:hover:text-gray-600 transition-colors" title="הזז למטה">
            <ChevronDown className="w-4 h-4" />
          </button>
        </div>
      )}

      <button onClick={() => onOpen(row)} className="relative w-28 h-28 mt-1" title="ערוך הכנסה צפויה">
        <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
          <circle cx="50" cy="50" r={R} fill="none" stroke={TRACK} strokeWidth="9" />
          {target != null && pct > 0 && (
            <circle cx="50" cy="50" r={R} fill="none" stroke="#10b981" strokeWidth="9"
              strokeDasharray={`${dash} ${C - dash}`} strokeLinecap="round" className="transition-all" />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-bold text-emerald-400 leading-none">{ils(row.earned)}</span>
          {target != null ? (
            <span className="text-xs mt-1 text-gray-400">מתוך {ils(target)}</span>
          ) : (
            <span className="text-xs mt-1 text-gray-600">אין יעד</span>
          )}
        </div>
      </button>

      <div className="flex items-center gap-1.5 mt-2 text-center">
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: colorFor(row.category) }} />
        <span className="text-sm text-white font-medium leading-tight">{row.category}</span>
      </div>

      {target != null && (
        <div className="mt-1 text-center text-xs leading-snug">
          {reached
            ? <div className="text-green-400">מעל היעד +{ils(row.earned - target)}</div>
            : <div className="text-gray-500">חסר {ils(target - row.earned)}</div>}
        </div>
      )}
    </div>
  )
}

/** Modal editor for a single category's budget + transactions drill-down.
 *  `isIncome` switches the wording from a spending limit to an expected-income target. */
function BudgetEditor({ row, month, suggestion, isIncome = false, onClose, onSaved }) {
  const options = monthOptions()
  const [value, setValue] = useState(row.limit ?? '')
  const [saving, setSaving] = useState(false)
  // Scope: 'recurring' = a default applying from `from` onward; 'month' = this month only.
  const [scope, setScope] = useState(row.source === 'month' ? 'month' : 'recurring')
  const [from, setFrom] = useState(row.effectiveFrom || month)

  const [txns, setTxns] = useState(null)
  const [txLoading, setTxLoading] = useState(true)

  useEffect(() => {
    setTxLoading(true)
    axios.get('/api/budgets/transactions', { params: { category: row.category, month } })
      .then(res => setTxns(res.data.rows))
      .catch(() => setTxns([]))
      .finally(() => setTxLoading(false))
  }, [row.category, month])

  async function save() {
    if (value === '' || isNaN(Number(value))) return
    setSaving(true)
    try {
      await axios.put('/api/budgets', {
        category: row.category,
        amount: Number(value),
        month: scope === 'month' ? month : '',
        effective_from: scope === 'recurring' ? from : '',
      })
      onSaved()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  async function clear() {
    setSaving(true)
    try {
      // Clear whichever scope currently provides the limit.
      await axios.delete('/api/budgets', { data: { category: row.category, month: row.source === 'month' ? month : '' } })
      onSaved()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  function onTxnChanged() {
    axios.get('/api/budgets/transactions', { params: { category: row.category, month } })
      .then(res => setTxns(res.data.rows)).catch(() => {})
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="bg-gray-900 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-white">{row.category} · {monthLabel(month)}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Amount */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">₪</span>
            <input
              type="number"
              value={value}
              onChange={e => setValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') save() }}
              placeholder={isIncome ? 'הגדר הכנסה צפויה' : 'הגדר תקציב חודשי'}
              autoFocus
              className="w-full bg-gray-800 text-white rounded-lg pr-8 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
            />
          </div>
          <button
            onClick={save}
            disabled={saving}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            שמור
          </button>
          {row.limit != null && (
            <button
              onClick={clear}
              disabled={saving}
              className="text-gray-500 hover:text-red-400 px-2 py-2 text-sm transition-colors"
            >
              נקה
            </button>
          )}
        </div>

        {/* Suggestion */}
        {suggestion > 0 && Number(value) !== suggestion && (
          <button
            onClick={() => setValue(String(suggestion))}
            className="mt-2 text-xs text-blue-400 hover:text-blue-300 transition-colors"
            title="ממוצע חודשי על פני 6 החודשים האחרונים"
          >
            הצע לפי 6 חודשים: ₪{suggestion.toLocaleString('he-IL')} (לחץ למילוי)
          </button>
        )}

        {/* Scope */}
        <div className="mt-4 space-y-2 text-sm">
          <label className="flex items-center gap-2 text-gray-300 cursor-pointer">
            <input type="radio" name="scope" checked={scope === 'recurring'}
              onChange={() => setScope('recurring')} className="accent-blue-600" />
            תקציב קבוע — חל מהחודש:
            <select
              value={from}
              onChange={e => setFrom(e.target.value)}
              disabled={scope !== 'recurring'}
              className="bg-gray-800 text-white rounded-lg px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            >
              {options.slice().reverse().map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-gray-300 cursor-pointer">
            <input type="radio" name="scope" checked={scope === 'month'}
              onChange={() => setScope('month')} className="accent-blue-600" />
            רק לחודש זה ({monthLabel(month)})
          </label>
        </div>

        {/* Accumulated balance reminder */}
        {row.carryover != null && (
          <div className="mt-3 text-xs text-gray-400">
            יתרה מצטברת מתחילת התקציב:{' '}
            <span className={row.carryover >= 0 ? 'text-green-400' : 'text-red-400'}>
              {row.carryover >= 0 ? '+' : '−'}{ils(Math.abs(row.carryover))}
            </span>
          </div>
        )}

        {/* Transactions */}
        <div className="mt-4 border-t border-gray-800 pt-3">
          <div className="text-sm text-gray-400 mb-2">תנועות החודש</div>
          {txLoading ? (
            <div className="text-gray-400 text-sm">טוען תנועות...</div>
          ) : !txns || txns.length === 0 ? (
            <div className="text-gray-500 text-sm">אין תנועות בקטגוריה זו לחודש הנבחר.</div>
          ) : (
            <div className="max-h-72 overflow-y-auto pl-3">
              <table className="w-full text-sm">
                <tbody>
                  {txns.map(t => <TxnRow key={t.id} txn={t} onChanged={onTxnChanged} />)}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** Bottom-of-page roll-up: planned vs actual income/expenses + balance per month.
 *  A start-month selector lets the user choose where the roll-up begins. */
function MonthlySummaryTable({ months }) {
  // Hooks must run unconditionally — default the start to the earliest month.
  const [from, setFrom] = useState('')
  if (!months.length) return null
  const signed = v => `${v >= 0 ? '+' : '−'}${ils(Math.abs(v))}`
  const balClass = v => v >= 0 ? 'text-green-400' : 'text-red-400'

  const start = from || months[0].month
  const visible = months.filter(m => m.month >= start)

  const totals = visible.reduce((a, m) => ({
    plannedIncome: a.plannedIncome + m.plannedIncome,
    actualIncome: a.actualIncome + m.actualIncome,
    plannedExpense: a.plannedExpense + m.plannedExpense,
    actualExpense: a.actualExpense + m.actualExpense,
    plannedBalance: a.plannedBalance + m.plannedBalance,
    actualBalance: a.actualBalance + m.actualBalance,
  }), { plannedIncome: 0, actualIncome: 0, plannedExpense: 0, actualExpense: 0, plannedBalance: 0, actualBalance: 0 })

  // Actual on top, planned (budget) below it in muted gray.
  const cell = (actual, planned, cls = 'text-gray-300') => (
    <td className="px-2 py-2 text-center font-mono">
      <div className={cls}>{ils(actual)}</div>
      <div className="text-[11px] text-gray-600">{ils(planned)}</div>
    </td>
  )

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <h3 className="text-sm font-medium text-gray-400">סיכום חודשי (בפועל / בתקציב)</h3>
        <label className="flex items-center gap-2 text-xs text-gray-500">
          מתחיל מ:
          <select
            value={start}
            onChange={e => setFrom(e.target.value)}
            className="bg-gray-800 text-gray-200 rounded-lg px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-blue-500"
          >
            {months.map(m => <option key={m.month} value={m.month}>{monthLabel(m.month)}</option>)}
          </select>
        </label>
      </div>
      <div className="bg-gray-900 rounded-xl p-2 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-500 text-xs">
              <th className="px-2 py-2 text-right font-medium">חודש</th>
              <th className="px-2 py-2 text-center font-medium">הכנסות</th>
              <th className="px-2 py-2 text-center font-medium">הוצאות</th>
              <th className="px-2 py-2 text-center font-medium">מאזן</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(m => (
              <tr key={m.month} className="border-t border-gray-800">
                <td className="px-2 py-2 text-right text-gray-300 whitespace-nowrap">{monthLabel(m.month)}</td>
                {cell(m.actualIncome, m.plannedIncome, 'text-emerald-400')}
                {cell(m.actualExpense, m.plannedExpense, 'text-gray-300')}
                <td className="px-2 py-2 text-center font-mono">
                  <div className={balClass(m.actualBalance)}>{signed(m.actualBalance)}</div>
                  <div className="text-[11px] text-gray-600">{signed(m.plannedBalance)}</div>
                </td>
              </tr>
            ))}
            {/* Grand total across all months */}
            <tr className="border-t-2 border-gray-700 font-medium">
              <td className="px-2 py-2 text-right text-white">סך הכול</td>
              {cell(totals.actualIncome, totals.plannedIncome, 'text-emerald-400')}
              {cell(totals.actualExpense, totals.plannedExpense, 'text-gray-200')}
              <td className="px-2 py-2 text-center font-mono">
                <div className={`font-bold ${balClass(totals.actualBalance)}`}>{signed(totals.actualBalance)}</div>
                <div className="text-[11px] text-gray-600">{signed(totals.plannedBalance)}</div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function BudgetsPage() {
  const { categories, reload: reloadCategories } = useCategories()
  const [month, setMonth] = useState(currentMonthKey())
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [suggestions, setSuggestions] = useState({})
  const [editing, setEditing] = useState(null)   // the row being edited, or null
  const [monthly, setMonthly] = useState([])     // per-month roll-up for the summary table
  const options = monthOptions()

  async function load() {
    try {
      const [overview, summary] = await Promise.all([
        axios.get('/api/budgets/overview', { params: { month } }),
        axios.get('/api/budgets/monthly-summary'),
      ])
      setData(overview.data)
      setMonthly(summary.data.months || [])
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [month])
  useEffect(() => {
    axios.get('/api/budgets/suggestions')
      .then(res => setSuggestions(res.data.suggestions || {}))
      .catch(() => setSuggestions({}))
  }, [])

  // Map category name -> id for the reorder controls.
  const idByName = Object.fromEntries(categories.map(c => [c.name, c.id]))

  async function move(catId, direction) {
    await axios.put(`/api/categories/${catId}/move`, { direction })
    await reloadCategories()   // refresh sort_order in the shared list
    await load()               // overview re-orders to match
  }

  if (loading) return <div className="text-gray-400">טוען תקציבים...</div>

  const rows = data?.rows || []
  const incomeRows = data?.incomeRows || []

  // Plan vs actual for the balance plaque.
  const plannedExpense = rows.reduce((s, r) => s + (r.limit || 0), 0)
  const actualExpense  = rows.reduce((s, r) => s + r.spent, 0)
  const plannedIncome  = incomeRows.reduce((s, r) => s + (r.limit || 0), 0)
  const actualIncome   = incomeRows.reduce((s, r) => s + r.earned, 0)
  const plannedBalance = plannedIncome - plannedExpense
  const actualBalance  = actualIncome - actualExpense
  const balanceClass = v => v >= 0 ? 'text-green-400' : 'text-red-400'
  const signed = v => `${v >= 0 ? '+' : '−'}${ils(Math.abs(v))}`

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-white">תקציבים חודשיים</h2>
        <select
          value={month}
          onChange={e => setMonth(e.target.value)}
          className="bg-gray-900 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
        >
          {options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
      </div>

      {/* Balance plaque: income − expenses, planned vs actual */}
      <div className="bg-gray-900 rounded-xl p-5 mb-5">
        <div className="grid grid-cols-3 gap-2 items-center text-sm">
          <div></div>
          <div className="text-center text-gray-500 text-xs">בתקציב</div>
          <div className="text-center text-gray-500 text-xs">בפועל</div>

          <div className="text-gray-300">הכנסות</div>
          <div className="text-center font-mono text-gray-400">{ils(plannedIncome)}</div>
          <div className="text-center font-mono text-emerald-400">{ils(actualIncome)}</div>

          <div className="text-gray-300">הוצאות</div>
          <div className="text-center font-mono text-gray-400">{ils(plannedExpense)}</div>
          <div className="text-center font-mono text-gray-300">{ils(actualExpense)}</div>
        </div>
        <div className="grid grid-cols-3 gap-2 items-center mt-3 pt-3 border-t border-gray-800">
          <div className="text-white font-medium">מאזן</div>
          <div className={`text-center font-mono font-bold ${balanceClass(plannedBalance)}`}>{signed(plannedBalance)}</div>
          <div className={`text-center font-mono font-bold text-lg ${balanceClass(actualBalance)}`}>{signed(actualBalance)}</div>
        </div>
      </div>

      {/* Income section */}
      {incomeRows.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-medium text-gray-400 mb-2">הכנסות</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {incomeRows.map((row, i) => (
              <IncomeTile
                key={row.category}
                row={row}
                catId={idByName[row.category]}
                isFirst={i === 0}
                isLast={i === incomeRows.length - 1}
                onMove={move}
                onOpen={setEditing}
              />
            ))}
          </div>
        </div>
      )}

      {/* Expense tiles */}
      <h3 className="text-sm font-medium text-gray-400 mb-2">הוצאות</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {rows.map((row, i) => (
          <BudgetTile
            key={row.category}
            row={row}
            catId={idByName[row.category]}
            isFirst={i === 0}
            isLast={i === rows.length - 1}
            onMove={move}
            onOpen={setEditing}
          />
        ))}
      </div>

      {/* Monthly roll-up across all months with data */}
      <MonthlySummaryTable months={monthly} />

      {editing && (
        <BudgetEditor
          row={editing}
          month={month}
          suggestion={suggestions[editing.category]}
          isIncome={editing.kind === 'income'}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}
    </div>
  )
}
