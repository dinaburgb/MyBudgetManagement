import { useState, useEffect } from 'react'
import { ChevronDown, ChevronLeft } from 'lucide-react'
import axios from 'axios'
import { ils } from '../colors.js'
import { useCategories } from '../CategoriesContext.jsx'
import NoteEditor from '../NoteEditor.jsx'

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

// Pick the bar color by how much of the budget is used.
function barTone(ratio) {
  if (ratio >= 1) return 'bg-red-500'
  if (ratio >= 0.8) return 'bg-amber-500'
  return 'bg-green-500'
}

function BudgetRow({ row, month, onlyThisMonth, onSaved }) {
  const { colorFor } = useCategories()
  const [value, setValue] = useState(row.limit ?? '')
  const [saving, setSaving] = useState(false)

  // Drill-down: this category's transactions for the selected month.
  const [open, setOpen] = useState(false)
  const [txns, setTxns] = useState(null)        // null = not loaded yet
  const [txLoading, setTxLoading] = useState(false)

  useEffect(() => { setValue(row.limit ?? '') }, [row.limit, month])
  // Collapse and drop cached transactions whenever the month changes.
  useEffect(() => { setOpen(false); setTxns(null) }, [month])

  async function toggleDrill() {
    const next = !open
    setOpen(next)
    if (next && txns === null) {
      setTxLoading(true)
      try {
        const res = await axios.get('/api/budgets/transactions', { params: { category: row.category, month } })
        setTxns(res.data.rows)
      } catch {
        setTxns([])
      } finally {
        setTxLoading(false)
      }
    }
  }
  function updateTxNote(id, note) {
    setTxns(prev => prev && prev.map(t => t.id === id ? { ...t, note } : t))
  }

  const limit = row.limit
  const ratio = limit ? row.spent / limit : 0
  const pct = Math.min(ratio * 100, 100)
  const over = limit != null && row.remaining < 0

  async function save() {
    if (value === '' || isNaN(Number(value))) return
    setSaving(true)
    try {
      await axios.put('/api/budgets', {
        category: row.category,
        amount: Number(value),
        month: onlyThisMonth ? month : '',
      })
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  async function clear() {
    setSaving(true)
    try {
      await axios.delete('/api/budgets', { data: { category: row.category, month: onlyThisMonth ? month : '' } })
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-gray-900 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full" style={{ background: colorFor(row.category) }} />
          <span className="text-white font-medium">{row.category}</span>
          {row.source === 'month' && (
            <span className="text-xs text-blue-400 bg-blue-500/10 rounded px-1.5 py-0.5">לחודש זה</span>
          )}
        </div>
        {row.spent > 0 ? (
          <button
            onClick={toggleDrill}
            className="flex items-center gap-1 text-sm font-mono text-gray-300 hover:text-white transition-colors"
            title="הצג תנועות"
          >
            {open ? <ChevronDown className="w-4 h-4 text-gray-500" /> : <ChevronLeft className="w-4 h-4 text-gray-500" />}
            {ils(row.spent)}{limit != null && <span className="text-gray-500"> / {ils(limit)}</span>}
          </button>
        ) : (
          <div className="text-sm font-mono text-gray-300">
            {ils(row.spent)}{limit != null && <span className="text-gray-500"> / {ils(limit)}</span>}
          </div>
        )}
      </div>

      {/* Progress bar */}
      {limit != null ? (
        <>
          <div className="h-2.5 rounded-full bg-gray-800 overflow-hidden">
            <div className={`h-full ${barTone(ratio)} transition-all`} style={{ width: `${pct}%` }} />
          </div>
          <div className="flex justify-between mt-1 text-xs">
            <span className={over ? 'text-red-400' : 'text-gray-500'}>
              {over ? `חריגה ב-${ils(-row.remaining)}` : `נותרו ${ils(row.remaining)}`}
            </span>
            <span className="text-gray-500">{Math.round(ratio * 100)}%</span>
          </div>
        </>
      ) : (
        <div className="text-xs text-gray-500">לא הוגדר תקציב</div>
      )}

      {/* Drill-down: this category's transactions for the month */}
      {open && (
        <div className="mt-3 border-t border-gray-800 pt-3">
          {txLoading ? (
            <div className="text-gray-400 text-sm">טוען תנועות...</div>
          ) : !txns || txns.length === 0 ? (
            <div className="text-gray-500 text-sm">אין תנועות בקטגוריה זו לחודש הנבחר.</div>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              <table className="w-full text-sm">
                <tbody>
                  {txns.map(t => (
                    <tr key={t.id} className="border-b border-gray-800/50">
                      <td className="py-2 pl-3 text-gray-400 whitespace-nowrap align-top">{t.date}</td>
                      <td className="py-2 text-white">
                        <div>{t.description}</div>
                        {t.type === 'installment' && t.installment_total > 1 && (
                          <span className="text-xs text-amber-400 bg-amber-500/10 rounded px-1.5 py-0.5">
                            תשלום {t.installment_number} מתוך {t.installment_total}
                          </span>
                        )}
                        <span className="text-gray-600 text-xs"> · {t.account_name}</span>
                        <div className="mt-1">
                          <NoteEditor id={t.id} note={t.note} onSaved={n => updateTxNote(t.id, n)} />
                        </div>
                      </td>
                      <td className={`py-2 text-left font-mono whitespace-nowrap align-top ${t.amount < 0 ? 'text-red-400' : 'text-green-400'}`}>
                        {t.amount < 0 ? '-' : '+'}{ils(Math.abs(t.amount))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Editor */}
      <div className="flex items-center gap-2 mt-3">
        <div className="relative flex-1">
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">₪</span>
          <input
            type="number"
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') save() }}
            placeholder="הגדר תקציב חודשי"
            className="w-full bg-gray-800 text-white rounded-lg pr-8 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
          />
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          שמור
        </button>
        {limit != null && (
          <button
            onClick={clear}
            disabled={saving}
            className="text-gray-500 hover:text-red-400 px-2 py-2 text-sm transition-colors"
          >
            נקה
          </button>
        )}
      </div>
    </div>
  )
}

export default function BudgetsPage() {
  const [month, setMonth] = useState(currentMonthKey())
  const [data, setData]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [onlyThisMonth, setOnlyThisMonth] = useState(false)
  const options = monthOptions()

  async function load() {
    try {
      const res = await axios.get('/api/budgets/overview', { params: { month } })
      setData(res.data)
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [month])

  if (loading) return <div className="text-gray-400">טוען תקציבים...</div>

  const rows = data?.rows || []
  const totalLimit = rows.reduce((s, r) => s + (r.limit || 0), 0)
  const totalSpent = rows.reduce((s, r) => s + r.spent, 0)
  const ratio = totalLimit ? totalSpent / totalLimit : 0

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

      {/* Total summary */}
      {totalLimit > 0 && (
        <div className="bg-gray-900 rounded-xl p-5 mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-white font-medium">סך הכול החודש</span>
            <span className="font-mono text-gray-300">{ils(totalSpent)} <span className="text-gray-500">/ {ils(totalLimit)}</span></span>
          </div>
          <div className="h-3 rounded-full bg-gray-800 overflow-hidden">
            <div className={`h-full ${barTone(ratio)} transition-all`} style={{ width: `${Math.min(ratio * 100, 100)}%` }} />
          </div>
        </div>
      )}

      {/* Scope toggle */}
      <label className="flex items-center gap-2 mb-4 text-sm text-gray-400 cursor-pointer select-none w-fit">
        <input
          type="checkbox"
          checked={onlyThisMonth}
          onChange={e => setOnlyThisMonth(e.target.checked)}
          className="w-4 h-4 accent-blue-600"
        />
        החל שינויים על החודש הנבחר בלבד (אחרת — תקציב קבוע לכל חודש)
      </label>

      {/* Per-category rows */}
      <div className="space-y-3">
        {rows.map(row => (
          <BudgetRow
            key={row.category}
            row={row}
            month={month}
            onlyThisMonth={onlyThisMonth}
            onSaved={load}
          />
        ))}
      </div>
    </div>
  )
}
