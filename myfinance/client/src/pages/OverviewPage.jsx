import { useState, useEffect } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  PieChart, Pie, Cell,
} from 'recharts'
import { TrendingUp, TrendingDown, Scale } from 'lucide-react'
import axios from 'axios'
import { colorFor, ils } from '../colors.js'

// Hebrew month label for a 'YYYY-MM' key, e.g. '2026-06' → 'יוני 26'
const HE_MONTHS = ['ינו', 'פבר', 'מרץ', 'אפר', 'מאי', 'יוני', 'יולי', 'אוג', 'ספט', 'אוק', 'נוב', 'דצמ']
function monthLabel(key) {
  const [y, m] = key.split('-')
  return `${HE_MONTHS[Number(m) - 1]} ${y.slice(2)}`
}

function Kpi({ icon: Icon, label, value, tone }) {
  const tones = {
    green: 'text-green-400 bg-green-500/10',
    red:   'text-red-400 bg-red-500/10',
    blue:  'text-blue-400 bg-blue-500/10',
  }
  return (
    <div className="bg-gray-900 rounded-xl p-5 flex items-center gap-4">
      <div className={`w-11 h-11 rounded-lg flex items-center justify-center ${tones[tone]}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <div className="text-gray-400 text-sm">{label}</div>
        <div className="text-xl font-bold text-white font-mono">{value}</div>
      </div>
    </div>
  )
}

// Dark tooltip shared by the charts
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
  const [data, setData]   = useState(null)
  const [months, setMonths] = useState(6)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    axios.get('/api/stats/overview', { params: { months } })
      .then(res => setData(res.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [months])

  if (loading) return <div className="text-gray-400">טוען נתונים...</div>
  if (!data) return <div className="text-gray-500">לא ניתן לטעון נתונים.</div>

  const monthly = data.monthly.map(m => ({ ...m, label: monthLabel(m.month) }))
  const pie = data.byCategory.map(c => ({ name: c.category, value: c.expenses }))
  const hasData = data.totals.expenses > 0 || data.totals.income > 0

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-white">סקירה כללית</h2>
        <select
          value={months}
          onChange={e => setMonths(Number(e.target.value))}
          className="bg-gray-900 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value={3}>3 חודשים אחרונים</option>
          <option value={6}>6 חודשים אחרונים</option>
          <option value={12}>12 חודשים אחרונים</option>
        </select>
      </div>

      {!hasData ? (
        <div className="text-center py-20 text-gray-500">
          אין עדיין נתונים. סנכרן חשבונות כדי לראות גרפים.
        </div>
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <Kpi icon={TrendingUp}   label="הכנסות בתקופה"  value={ils(data.totals.income)}   tone="green" />
            <Kpi icon={TrendingDown} label="הוצאות בתקופה"  value={ils(data.totals.expenses)} tone="red" />
            <Kpi icon={Scale}        label="מאזן"           value={ils(data.totals.balance)}  tone="blue" />
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
              <h3 className="text-white font-medium mb-4">הוצאות לפי קטגוריה</h3>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={pie} dataKey="value" nameKey="name"
                    cx="50%" cy="50%" innerRadius={62} outerRadius={100} paddingAngle={2}
                  >
                    {pie.map(entry => <Cell key={entry.name} fill={colorFor(entry.name)} stroke="#111827" />)}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
