import { useState, useEffect, useMemo } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  PieChart, Pie, Cell,
} from 'recharts'
import { TrendingUp, TrendingDown, Scale, Wallet } from 'lucide-react'
import axios from 'axios'
import { ils } from '../colors.js'
import { useCategories } from '../CategoriesContext.jsx'
import NoteEditor from '../NoteEditor.jsx'

const HE_SHORT = ['ינו', 'פבר', 'מרץ', 'אפר', 'מאי', 'יוני', 'יולי', 'אוג', 'ספט', 'אוק', 'נוב', 'דצמ']
const HE_LONG  = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר']

function monthShort(key) { const [y, m] = key.split('-'); return `${HE_SHORT[+m - 1]} ${y.slice(2)}` }
function monthLong(key)  { const [y, m] = key.split('-'); return `${HE_LONG[+m - 1]} ${y}` }

// Build the last `n` month keys, newest first.
function recentMonths(n) {
  const out = []
  const d = new Date()
  for (let i = 0; i < n; i++) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1)
    out.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

function Kpi({ icon: Icon, label, value, tone }) {
  const tones = {
    green: 'text-green-400 bg-green-500/10',
    red:   'text-red-400 bg-red-500/10',
    blue:  'text-blue-400 bg-blue-500/10',
    violet:'text-violet-400 bg-violet-500/10',
  }
  return (
    <div className="bg-gray-900 rounded-xl p-4 flex items-center gap-3">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${tones[tone]}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <div className="text-gray-400 text-xs">{label}</div>
        <div className="text-lg font-bold text-white font-mono truncate">{value}</div>
      </div>
    </div>
  )
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm shadow-xl">
      {label && <div className="text-gray-300 mb-1">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 text-white">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: p.color || p.payload.fill }} />
          <span className="text-gray-400">{p.name}:</span>
          <span className="font-mono">{ils(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

export default function OverviewPage() {
  const { colorFor } = useCategories()
  const monthChips = useMemo(() => recentMonths(18), [])           // newest first
  const [selMonths, setSelMonths]     = useState(() => new Set(recentMonths(1)))
  const [rangeFrom, setRangeFrom]     = useState('')
  const [rangeTo, setRangeTo]         = useState('')
  const [accounts, setAccounts]       = useState([])
  const [selAccounts, setSelAccounts] = useState(null)            // Set of ids, null until loaded
  const [data, setData]   = useState(null)
  const [loading, setLoading] = useState(true)

  // Load accounts and default the selection to those included in totals.
  useEffect(() => {
    axios.get('/api/accounts').then(res => {
      setAccounts(res.data)
      setSelAccounts(new Set(res.data.filter(a => a.include_in_totals).map(a => a.id)))
    }).catch(() => { setAccounts([]); setSelAccounts(new Set()) })
  }, [])

  // Fetch stats whenever the month or account selection changes.
  useEffect(() => {
    if (selAccounts === null) return
    setLoading(true)
    const months = [...selMonths].sort().join(',')
    const acc = [...selAccounts].join(',')
    axios.get('/api/stats/overview', { params: { months, accounts: acc } })
      .then(res => setData(res.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [selMonths, selAccounts])

  function toggleMonth(key) {
    setSelMonths(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }
  function quick(n) { setSelMonths(new Set(recentMonths(n))); setRangeFrom(''); setRangeTo('') }
  function thisYear() {
    const y = new Date().getFullYear()
    setSelMonths(new Set(monthChips.filter(m => m.startsWith(`${y}-`))))
    setRangeFrom(''); setRangeTo('')
  }
  // Apply a contiguous from→to range over the available chips.
  function applyRange(from, to) {
    if (!from || !to) return
    const [lo, hi] = from <= to ? [from, to] : [to, from]
    setSelMonths(new Set(monthChips.filter(m => m >= lo && m <= hi)))
  }
  function toggleAccount(id) {
    setSelAccounts(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // Drill-down: clicking a pie slice loads that category's transactions for the
  // current month/account selection.
  const [drill, setDrill] = useState(null)        // { category, rows } | null
  const [drillLoading, setDrillLoading] = useState(false)
  function openDrill(category) {
    if (!category) return
    setDrill({ category, rows: [] })
    setDrillLoading(true)
    const months = [...selMonths].sort().join(',')
    const acc = [...(selAccounts || [])].join(',')
    axios.get('/api/stats/transactions', { params: { category, months, accounts: acc } })
      .then(res => setDrill({ category, rows: res.data.rows }))
      .catch(() => setDrill({ category, rows: [] }))
      .finally(() => setDrillLoading(false))
  }
  function updateDrillNote(id, note) {
    setDrill(d => d && ({ ...d, rows: d.rows.map(r => r.id === id ? { ...r, note } : r) }))
  }

  const monthly = (data?.monthly || []).map(m => ({ ...m, label: monthShort(m.month) }))
  const pie = (data?.byCategory || []).map(c => ({ name: c.category, value: c.expenses }))
  const hasData = data && (data.totals.expenses > 0 || data.totals.income > 0)

  return (
    <div>
      <h2 className="text-xl font-bold text-white mb-4">סקירה כללית</h2>

      {/* Controls */}
      <div className="bg-gray-900 rounded-xl p-4 mb-6 space-y-4">
        {/* Period */}
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="text-sm text-gray-400 ml-1">תקופה:</span>
            <button onClick={() => quick(3)}  className="px-2.5 py-1 rounded-lg bg-gray-800 hover:bg-gray-700 text-xs text-gray-200">3 ח'</button>
            <button onClick={() => quick(6)}  className="px-2.5 py-1 rounded-lg bg-gray-800 hover:bg-gray-700 text-xs text-gray-200">6 ח'</button>
            <button onClick={() => quick(12)} className="px-2.5 py-1 rounded-lg bg-gray-800 hover:bg-gray-700 text-xs text-gray-200">12 ח'</button>
            <button onClick={thisYear}        className="px-2.5 py-1 rounded-lg bg-gray-800 hover:bg-gray-700 text-xs text-gray-200">השנה</button>
            {/* Range from–to */}
            <span className="text-gray-600 mx-1">|</span>
            <span className="text-xs text-gray-500">טווח:</span>
            <select value={rangeFrom} onChange={e => { setRangeFrom(e.target.value); applyRange(e.target.value, rangeTo) }}
              className="bg-gray-800 text-white rounded-lg px-2 py-1 text-xs outline-none">
              <option value="">מ…</option>
              {monthChips.map(m => <option key={m} value={m}>{monthLong(m)}</option>)}
            </select>
            <span className="text-xs text-gray-500">עד</span>
            <select value={rangeTo} onChange={e => { setRangeTo(e.target.value); applyRange(rangeFrom, e.target.value) }}
              className="bg-gray-800 text-white rounded-lg px-2 py-1 text-xs outline-none">
              <option value="">…עד</option>
              {monthChips.map(m => <option key={m} value={m}>{monthLong(m)}</option>)}
            </select>
          </div>
          {/* Month chips (arbitrary set) */}
          <div className="flex flex-wrap gap-1.5">
            {monthChips.map(m => {
              const on = selMonths.has(m)
              return (
                <button
                  key={m}
                  onClick={() => toggleMonth(m)}
                  className={`px-2 py-1 rounded-md text-xs transition-colors ${
                    on ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  {monthShort(m)}
                </button>
              )
            })}
          </div>
        </div>

        {/* Accounts */}
        {accounts.length > 0 && (
          <div>
            <div className="text-sm text-gray-400 mb-2">חשבונות בסקירה:</div>
            <div className="flex flex-wrap gap-3">
              {accounts.map(a => (
                <label key={a.id} className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={!!selAccounts?.has(a.id)}
                    onChange={() => toggleAccount(a.id)}
                    className="w-4 h-4 accent-blue-600"
                  />
                  {a.name}
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Body */}
      {loading ? (
        <div className="text-gray-400">טוען נתונים...</div>
      ) : selMonths.size === 0 ? (
        <div className="text-center py-16 text-gray-500">בחר לפחות חודש אחד.</div>
      ) : !hasData ? (
        <div className="text-center py-16 text-gray-500">אין נתונים לבחירה הזו.</div>
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <Kpi icon={TrendingUp}   label="הכנסות בתקופה" value={ils(data.totals.income)}   tone="green" />
            <Kpi icon={TrendingDown} label="הוצאות בתקופה" value={ils(data.totals.expenses)} tone="red" />
            <Kpi icon={Scale}        label="מאזן התקופה"   value={ils(data.totals.balance)}  tone="blue" />
            <Kpi icon={Wallet}       label="יתרה נוכחית"   value={ils(data.netBalance)}      tone="violet" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Monthly income vs expenses */}
            <div className="bg-gray-900 rounded-xl p-5">
              <h3 className="text-white font-medium mb-4">הכנסות מול הוצאות לפי חודש</h3>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={monthly} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: '#9ca3af', fontSize: 12 }} axisLine={{ stroke: '#374151' }} tickLine={false} />
                  <YAxis tick={{ fill: '#9ca3af', fontSize: 12 }} axisLine={false} tickLine={false}
                         width={70} tickFormatter={v => ils(v)} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: '#ffffff08' }} />
                  <Legend wrapperStyle={{ fontSize: 13 }} />
                  <Bar dataKey="income"   name="הכנסות" fill="#34d399" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="expenses" name="הוצאות" fill="#f87171" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Expenses by category */}
            <div className="bg-gray-900 rounded-xl p-5">
              <h3 className="text-white font-medium mb-1">הוצאות לפי קטגוריה</h3>
              <p className="text-xs text-gray-500 mb-3">לחץ על פלח כדי לראות את החיובים</p>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={pie} dataKey="value" nameKey="name" cx="50%" cy="50%"
                       innerRadius={62} outerRadius={100} paddingAngle={2}
                       cursor="pointer" onClick={d => openDrill(d?.name)}>
                    {pie.map(entry => <Cell key={entry.name} fill={colorFor(entry.name)} stroke="#111827" />)}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Drill-down: transactions for the clicked category */}
          {drill && (
            <div className="bg-gray-900 rounded-xl p-5 mt-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-white font-medium flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full" style={{ background: colorFor(drill.category) }} />
                  חיובים בקטגוריה: {drill.category}
                  <span className="text-gray-500 text-sm">({drill.rows.length})</span>
                </h3>
                <button onClick={() => setDrill(null)} className="text-gray-400 hover:text-white text-sm">סגור ✕</button>
              </div>
              {drillLoading ? (
                <div className="text-gray-400 text-sm">טוען...</div>
              ) : drill.rows.length === 0 ? (
                <div className="text-gray-500 text-sm">אין חיובים בקטגוריה זו לבחירה הנוכחית.</div>
              ) : (
                <div className="max-h-96 overflow-y-auto">
                  <table className="w-full text-sm">
                    <tbody>
                      {drill.rows.map(r => (
                        <tr key={r.id} className="border-b border-gray-800/50">
                          <td className="py-2 pl-3 text-gray-400 whitespace-nowrap align-top">{r.date}</td>
                          <td className="py-2 text-white">
                            <div>{r.description}</div>
                            {r.type === 'installment' && r.installment_total > 1 && (
                              <span className="text-xs text-amber-400 bg-amber-500/10 rounded px-1.5 py-0.5">
                                תשלום {r.installment_number} מתוך {r.installment_total}
                              </span>
                            )}
                            <span className="text-gray-600 text-xs"> · {r.account_name}</span>
                            <div className="mt-1">
                              <NoteEditor id={r.id} note={r.note} onSaved={n => updateDrillNote(r.id, n)} />
                            </div>
                          </td>
                          <td className={`py-2 text-left font-mono whitespace-nowrap align-top ${r.amount < 0 ? 'text-red-400' : 'text-green-400'}`}>
                            {r.amount < 0 ? '-' : '+'}{ils(Math.abs(r.amount))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
