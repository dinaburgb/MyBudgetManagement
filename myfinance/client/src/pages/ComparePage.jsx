import { useState, useEffect, useMemo } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts'
import { ArrowLeftRight, ChevronDown, ChevronRight } from 'lucide-react'
import axios from 'axios'
import { ils } from '../colors.js'
import { useCategories } from '../CategoriesContext.jsx'

const HE_SHORT = ['ינו', 'פבר', 'מרץ', 'אפר', 'מאי', 'יוני', 'יולי', 'אוג', 'ספט', 'אוק', 'נוב', 'דצמ']
function monthShort(key) { const [y, m] = key.split('-'); return `${HE_SHORT[+m - 1]} ${y.slice(2)}` }

function monthsBack(offset, count) {
  const out = []
  const d = new Date()
  for (let i = 0; i < count; i++) {
    const m = new Date(d.getFullYear(), d.getMonth() - offset - i, 1)
    out.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`)
  }
  return out.sort()
}
function recentChips(n) {
  const out = []
  const d = new Date()
  for (let i = 0; i < n; i++) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1)
    out.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm shadow-xl">
      {label && <div className="text-gray-300 mb-1">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 text-white">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: p.color }} />
          <span className="text-gray-400">{p.name}:</span>
          <span className="font-mono">{ils(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

function PeriodPicker({ label, chips, selected, onToggle }) {
  return (
    <div>
      <div className="text-sm text-gray-300 mb-2">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {chips.map(m => {
          const on = selected.has(m)
          return (
            <button key={m} onClick={() => onToggle(m)}
              className={`px-2 py-1 rounded-md text-xs transition-colors ${
                on ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
              {monthShort(m)}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// Inline transactions list shown when a category row is expanded
function TxnList({ category, months, accounts }) {
  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const acc = [...accounts].join(',')
    const mStr = months.join(',')
    axios.get('/api/stats/transactions', { params: { category, months: mStr, accounts: acc } })
      .then(r => setRows(r.data.rows))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [category, months, accounts])

  if (loading) return <div className="text-gray-500 text-xs py-2 px-3">טוען...</div>
  if (!rows?.length) return <div className="text-gray-500 text-xs py-2 px-3">אין עסקאות</div>

  return (
    <table className="w-full text-xs">
      <tbody>
        {rows.map(t => (
          <tr key={t.id} className="border-b border-gray-800/30 hover:bg-gray-800/20">
            <td className="py-1.5 pl-3 text-gray-500 whitespace-nowrap w-20">{t.date}</td>
            <td className="py-1.5 text-gray-300 max-w-0" style={{ width: '100%' }}>
              <span className="block truncate" dir="auto">{t.description}</span>
              {t.account_name && (
                <span className="text-gray-600 text-[10px]">{t.account_name}</span>
              )}
            </td>
            <td className={`py-1.5 pr-3 font-mono whitespace-nowrap text-right ${t.amount < 0 ? 'text-red-400' : 'text-green-400'}`}>
              {t.amount < 0 ? '' : '+'}{ils(Math.abs(t.amount))}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// Matrix table: months as columns, categories as rows, with expand-to-transactions
function MatrixTable({ matrixData, months, periodA, periodB, accounts }) {
  const { colorFor } = useCategories()
  const [expanded, setExpanded] = useState(new Set())

  function toggleRow(cat) {
    setExpanded(prev => {
      const n = new Set(prev)
      n.has(cat) ? n.delete(cat) : n.add(cat)
      return n
    })
  }

  if (!matrixData) return null
  const { rows, totals } = matrixData

  return (
    <div className="bg-gray-900 rounded-xl overflow-x-auto mb-6">
      <table className="w-full text-xs min-w-max">
        <thead>
          <tr className="border-b border-gray-700">
            <th className="text-right py-3 px-3 font-medium text-gray-400 sticky right-0 bg-gray-900 min-w-[9rem]">
              קטגוריה
            </th>
            {months.map(m => (
              <th key={m} className="text-center py-3 px-2 font-medium whitespace-nowrap min-w-[6rem]">
                <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${
                  periodA.has(m) && periodB.has(m)
                    ? 'bg-purple-800/60 text-purple-200'
                    : periodA.has(m)
                    ? 'bg-blue-800/60 text-blue-200'
                    : 'bg-gray-700/60 text-gray-300'
                }`}>
                  {monthShort(m)}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const isOpen = expanded.has(row.category)
            return [
              <tr key={row.category}
                onClick={() => toggleRow(row.category)}
                className="border-b border-gray-800/40 hover:bg-gray-800/30 cursor-pointer transition-colors">
                <td className="py-2 px-3 sticky right-0 bg-gray-900 hover:bg-gray-800/30">
                  <div className="flex items-center gap-1.5">
                    {isOpen
                      ? <ChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                      : <ChevronRight className="w-3.5 h-3.5 text-gray-500 shrink-0" />}
                    <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: colorFor(row.category) }} />
                    <span className="text-white font-medium">{row.category}</span>
                  </div>
                </td>
                {months.map(m => {
                  const val = row.byMonth[m] || 0
                  return (
                    <td key={m} className="py-2 px-2 text-center font-mono text-gray-300">
                      {val ? ils(val) : <span className="text-gray-700">—</span>}
                    </td>
                  )
                })}
              </tr>,

              isOpen && (
                <tr key={`${row.category}-txn`} className="border-b border-gray-800">
                  <td colSpan={months.length + 1} className="bg-gray-950/60 py-1">
                    <TxnList
                      category={row.category}
                      months={months}
                      accounts={accounts}
                    />
                  </td>
                </tr>
              )
            ]
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-gray-700">
            <td className="py-2.5 px-3 text-gray-300 font-bold sticky right-0 bg-gray-900">סה"כ</td>
            {months.map(m => (
              <td key={m} className="py-2.5 px-2 text-center font-mono font-bold text-white">
                {ils(totals[m] || 0)}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

export default function ComparePage() {
  const { names, colorFor } = useCategories()
  const chips = useMemo(() => recentChips(18), [])
  const [accounts, setAccounts] = useState([])
  const [selAccounts, setSelAccounts] = useState(null)
  const [periodA, setPeriodA] = useState(() => new Set(monthsBack(0, 2)))
  const [periodB, setPeriodB] = useState(() => new Set(monthsBack(2, 2)))
  const [focus, setFocus] = useState('')
  const [dataA, setDataA] = useState(null)
  const [dataB, setDataB] = useState(null)
  const [matrixData, setMatrixData] = useState(null)
  const [loading, setLoading] = useState(true)

  // All months from both periods, sorted
  const allMonths = useMemo(() => [...new Set([...periodA, ...periodB])].sort(), [periodA, periodB])

  useEffect(() => {
    axios.get('/api/accounts').then(res => {
      setAccounts(res.data)
      setSelAccounts(new Set(res.data.filter(a => a.include_in_totals).map(a => a.id)))
    }).catch(() => { setAccounts([]); setSelAccounts(new Set()) })
  }, [])

  useEffect(() => {
    if (selAccounts === null) return
    setLoading(true)
    const acc = [...selAccounts].join(',')
    const get = months => axios.get('/api/stats/overview', { params: { months: [...months].sort().join(','), accounts: acc } }).then(r => r.data)
    const getMatrix = () => axios.get('/api/stats/matrix', { params: { months: allMonths.join(','), accounts: acc } }).then(r => r.data)

    Promise.all([get(periodA), get(periodB), getMatrix()])
      .then(([a, b, matrix]) => { setDataA(a); setDataB(b); setMatrixData(matrix) })
      .catch(() => { setDataA(null); setDataB(null); setMatrixData(null) })
      .finally(() => setLoading(false))
  }, [periodA, periodB, selAccounts, allMonths])

  function toggle(setter) {
    return key => setter(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })
  }
  function toggleAccount(id) {
    setSelAccounts(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function preset(countA, countB) {
    setPeriodA(new Set(monthsBack(0, countA)))
    setPeriodB(new Set(monthsBack(countA, countB)))
  }

  const aMap = new Map((dataA?.byCategory || []).map(c => [c.category, c.expenses]))
  const bMap = new Map((dataB?.byCategory || []).map(c => [c.category, c.expenses]))
  let cats = [...new Set([...aMap.keys(), ...bMap.keys()])]
  if (focus) cats = cats.filter(c => c === focus)
  const rows = cats.map(c => {
    const a = aMap.get(c) || 0, b = bMap.get(c) || 0
    return { category: c, a, b, diff: a - b, pct: b ? ((a - b) / b) * 100 : null }
  }).sort((x, y) => (y.a + y.b) - (x.a + x.b))

  const chart = rows.slice(0, 10).map(r => ({ category: r.category, 'תקופה א': r.a, 'תקופה ב': r.b }))
  const totalA = rows.reduce((s, r) => s + r.a, 0)
  const totalB = rows.reduce((s, r) => s + r.b, 0)

  return (
    <div className="max-w-5xl">
      <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
        <ArrowLeftRight className="w-5 h-5" /> השוואת תקופות
      </h2>

      {/* Controls */}
      <div className="bg-gray-900 rounded-xl p-4 mb-6 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-gray-400 ml-1">השוואה מהירה:</span>
          <button onClick={() => preset(1, 1)} className="px-2.5 py-1 rounded-lg bg-gray-800 hover:bg-gray-700 text-xs text-gray-200">חודש מול חודש קודם</button>
          <button onClick={() => preset(2, 2)} className="px-2.5 py-1 rounded-lg bg-gray-800 hover:bg-gray-700 text-xs text-gray-200">חודשיים מול חודשיים</button>
          <button onClick={() => preset(3, 3)} className="px-2.5 py-1 rounded-lg bg-gray-800 hover:bg-gray-700 text-xs text-gray-200">3 מול 3</button>
          <span className="text-gray-600 mx-1">|</span>
          <span className="text-xs text-gray-500">קטגוריה:</span>
          <select value={focus} onChange={e => setFocus(e.target.value)}
            className="bg-gray-800 text-white rounded-lg px-2 py-1 text-xs outline-none">
            <option value="">כל הקטגוריות</option>
            {names.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <PeriodPicker label="תקופה א' (כחול)" chips={chips} selected={periodA} onToggle={toggle(setPeriodA)} />
          <PeriodPicker label="תקופה ב' (אפור)" chips={chips} selected={periodB} onToggle={toggle(setPeriodB)} />
        </div>

        {accounts.length > 0 && (
          <div>
            <div className="text-sm text-gray-400 mb-2">חשבונות:</div>
            <div className="flex flex-wrap gap-3">
              {accounts.map(a => (
                <label key={a.id} className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer select-none">
                  <input type="checkbox" checked={!!selAccounts?.has(a.id)} onChange={() => toggleAccount(a.id)} className="w-4 h-4 accent-blue-600" />
                  {a.name}
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {loading ? (
        <div className="text-gray-400">טוען נתונים...</div>
      ) : (
        <>
          {/* Matrix table */}
          {matrixData && allMonths.length > 0 && (
            <MatrixTable
              matrixData={matrixData}
              months={allMonths}
              periodA={periodA}
              periodB={periodB}
              accounts={selAccounts || new Set()}
            />
          )}

          {rows.length === 0 ? (
            <div className="text-center py-16 text-gray-500">אין נתונים להשוואה.</div>
          ) : (
            <>
              {/* Totals */}
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="bg-gray-900 rounded-xl p-4">
                  <div className="text-gray-400 text-xs">תקופה א'</div>
                  <div className="text-lg font-bold text-blue-400 font-mono">{ils(totalA)}</div>
                </div>
                <div className="bg-gray-900 rounded-xl p-4">
                  <div className="text-gray-400 text-xs">תקופה ב'</div>
                  <div className="text-lg font-bold text-gray-300 font-mono">{ils(totalB)}</div>
                </div>
                <div className="bg-gray-900 rounded-xl p-4">
                  <div className="text-gray-400 text-xs">שינוי</div>
                  <div className={`text-lg font-bold font-mono ${totalA - totalB > 0 ? 'text-red-400' : 'text-green-400'}`}>
                    {totalA - totalB > 0 ? '+' : ''}{ils(totalA - totalB)}
                  </div>
                </div>
              </div>

              {/* Grouped bar chart */}
              <div className="bg-gray-900 rounded-xl p-5 mb-6">
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={chart} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
                    <XAxis dataKey="category" tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={{ stroke: '#374151' }} tickLine={false} interval={0} angle={-15} textAnchor="end" height={50} />
                    <YAxis tick={{ fill: '#9ca3af', fontSize: 12 }} axisLine={false} tickLine={false} width={70} tickFormatter={v => ils(v)} />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: '#ffffff08' }} />
                    <Legend wrapperStyle={{ fontSize: 13 }} />
                    <Bar dataKey="תקופה א" fill="#60a5fa" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="תקופה ב" fill="#6b7280" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Comparison table */}
              <div className="bg-gray-900 rounded-xl p-5">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-400 border-b border-gray-800">
                      <th className="text-right py-2 font-medium">קטגוריה</th>
                      <th className="text-left py-2 font-medium">תקופה א'</th>
                      <th className="text-left py-2 font-medium">תקופה ב'</th>
                      <th className="text-left py-2 font-medium">שינוי</th>
                      <th className="text-left py-2 font-medium">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.category} className="border-b border-gray-800/50">
                        <td className="py-2 text-white">
                          <span className="inline-block w-2.5 h-2.5 rounded-full ml-2 align-middle" style={{ background: colorFor(r.category) }} />
                          {r.category}
                        </td>
                        <td className="py-2 text-left font-mono text-blue-400">{ils(r.a)}</td>
                        <td className="py-2 text-left font-mono text-gray-300">{ils(r.b)}</td>
                        <td className={`py-2 text-left font-mono ${r.diff > 0 ? 'text-red-400' : r.diff < 0 ? 'text-green-400' : 'text-gray-500'}`}>
                          {r.diff > 0 ? '+' : ''}{ils(r.diff)}
                        </td>
                        <td className={`py-2 text-left font-mono ${r.diff > 0 ? 'text-red-400' : r.diff < 0 ? 'text-green-400' : 'text-gray-500'}`}>
                          {r.pct == null ? '—' : `${r.pct > 0 ? '+' : ''}${Math.round(r.pct)}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
