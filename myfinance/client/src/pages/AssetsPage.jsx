import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, History, TrendingUp, X, ArrowUp, ArrowDown } from 'lucide-react'
import axios from 'axios'
import { ils } from '../colors.js'

// Predefined lists for the dropdowns. All accept free text via the "אחר…"
// option, so the user is never boxed in.
const INSTITUTIONS = [
  'כלל ביטוח', 'הראל', 'מיטב', 'מור', 'אקסלנס', 'פסגות', 'אינטראקטיב ברוקרס',
  'בנק מזרחי', 'בנק הפועלים', 'בנק דיסקונט',
]
const ASSET_TYPES = [
  'קרן פנסיה', 'קופת גמל', 'קרן השתלמות', 'גמל להשקעה',
  'פוליסת חיסכון', 'ביטוח מנהלים', 'תיק השקעות', 'קרן נאמנות',
]
// High-level grouping, shown as a badge and summed in the category breakdown.
const CATEGORIES = [
  'חיסכון פנסיוני', 'שוק ההון', 'נדל״ן', 'הלוואות חברתיות', 'קרן ביטחון', 'מזומן ועו״ש',
]
// Suggested types when the row is a liability (a debt we owe).
const LIABILITY_TYPES = ['הלוואת בנק', 'משכנתא', 'הלוואה חברתית', 'מסגרת אשראי']
const OWNERS = [
  { value: 'Boris', label: 'בוריס' },
  { value: 'Irena', label: 'אירינה' },
  { value: 'Joint', label: 'משותף' },
]
const CURRENCIES = ['ILS', 'USD', 'EUR']
const CUR_SYMBOL = { ILS: '₪', USD: '$', EUR: '€' }

const ownerLabel = (v) => OWNERS.find(o => o.value === v)?.label || v
function money(n, currency = 'ILS') {
  if (n == null) return '—'
  const v = Math.round(Number(n) || 0)
  return `${CUR_SYMBOL[currency] || ''}${v.toLocaleString('he-IL')}`
}
function todayYMD() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const field = 'bg-gray-800 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500'

/** Select with the listed options plus a free-text "אחר…" fallback. */
function ComboSelect({ value, onChange, options, placeholder }) {
  const isCustom = value !== '' && !options.includes(value)
  const [custom, setCustom] = useState(isCustom)
  return custom ? (
    <div className="flex items-center gap-1">
      <input
        type="text" value={value} dir="auto" autoFocus placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className={`${field} w-40 placeholder-gray-500`}
      />
      <button type="button" onClick={() => { setCustom(false); onChange(options[0]) }}
        className="text-gray-500 hover:text-white text-xs">רשימה</button>
    </div>
  ) : (
    <select
      value={value}
      onChange={e => { if (e.target.value === '__other') { setCustom(true); onChange('') } else onChange(e.target.value) }}
      className={field}
    >
      <option value="" disabled>{placeholder}</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
      <option value="__other">אחר…</option>
    </select>
  )
}

/** Owner picker: the known owners (בוריס/אירינה/משותף) plus a free-text "אחר…"
 *  so a new owner (e.g. a child's name) can be typed. Custom owners store the
 *  typed text as both value and label. */
function OwnerSelect({ value, onChange }) {
  const known = OWNERS.some(o => o.value === value)
  const [custom, setCustom] = useState(value !== '' && !known)
  return custom ? (
    <div className="flex items-center gap-1">
      <input
        type="text" value={value} dir="auto" autoFocus placeholder="שם בעלים"
        onChange={e => onChange(e.target.value)}
        className={`${field} w-32 placeholder-gray-500`}
      />
      <button type="button" onClick={() => { setCustom(false); onChange('Boris') }}
        className="text-gray-500 hover:text-white text-xs">רשימה</button>
    </div>
  ) : (
    <select
      value={value}
      onChange={e => { if (e.target.value === '__other') { setCustom(true); onChange('') } else onChange(e.target.value) }}
      className={field}
    >
      {OWNERS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      <option value="__other">אחר…</option>
    </select>
  )
}

/** Add / edit an asset (or liability) definition. */
function AssetForm({ initial, defaultKind = 'asset', onSaved, onClose }) {
  const [kind, setKind]               = useState(initial?.kind || defaultKind)
  const [category, setCategory]       = useState(initial?.category || '')
  const [institution, setInstitution] = useState(initial?.institution || INSTITUTIONS[0])
  const [assetType, setAssetType]     = useState(initial?.asset_type || ASSET_TYPES[0])
  const [label, setLabel]             = useState(initial?.label || '')
  const [owner, setOwner]             = useState(initial?.owner || 'Boris')
  const [currency, setCurrency]       = useState(initial?.currency || 'ILS')
  const [note, setNote]               = useState(initial?.note || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const isLiability = kind === 'liability'

  async function submit(e) {
    e.preventDefault(); setError('')
    if (!institution || !assetType) { setError('בחר גוף וסוג'); return }
    setBusy(true)
    const body = { kind, category, institution, asset_type: assetType, label, owner, currency, note }
    try {
      if (initial) await axios.put(`/api/assets/${initial.id}`, { ...body, archived: initial.archived })
      else await axios.post('/api/assets', body)
      onSaved()
    } catch (err) {
      setError(err.response?.data?.error || 'שגיאה בשמירה')
    } finally { setBusy(false) }
  }

  return (
    <form onSubmit={submit} className="bg-gray-900 rounded-xl p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-white font-medium">
          {initial ? (isLiability ? 'עריכת התחייבות' : 'עריכת נכס') : (isLiability ? 'הוספת התחייבות' : 'הוספת נכס פיננסי')}
        </h3>
        <button type="button" onClick={onClose} className="text-gray-400 hover:text-white text-sm">סגור ✕</button>
      </div>
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-gray-400 mb-1">סוג רשומה</label>
          <select value={kind} onChange={e => setKind(e.target.value)} className={field}>
            <option value="asset">נכס</option>
            <option value="liability">התחייבות</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">קטגוריה</label>
          <ComboSelect value={category} onChange={setCategory} options={CATEGORIES} placeholder="בחר קטגוריה" />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">{isLiability ? 'גוף מלווה' : 'חברה / גוף'}</label>
          <ComboSelect value={institution} onChange={setInstitution} options={INSTITUTIONS} placeholder="בחר גוף" />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">{isLiability ? 'סוג התחייבות' : 'סוג חיסכון'}</label>
          <ComboSelect value={assetType} onChange={setAssetType} options={isLiability ? LIABILITY_TYPES : ASSET_TYPES} placeholder="בחר סוג" />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">תיאור / מס׳ פוליסה (רשות)</label>
          <input type="text" value={label} dir="auto" onChange={e => setLabel(e.target.value)}
            placeholder="למשל: פוליסה 12345" className={`${field} w-48 placeholder-gray-500`} />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">בעלים</label>
          <OwnerSelect value={owner} onChange={setOwner} />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">מטבע</label>
          <select value={currency} onChange={e => setCurrency(e.target.value)} className={field}>
            {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <button type="submit" disabled={busy}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          {busy ? 'שומר...' : 'שמור'}
        </button>
      </div>
      {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
    </form>
  )
}

/** Inline form to record a new balance update (snapshot) for an asset. */
function SnapshotForm({ asset, onSaved, onClose }) {
  const [date, setDate]         = useState(todayYMD())
  const [balance, setBalance]   = useState(asset.last_balance != null ? String(asset.last_balance) : '')
  const [deposits, setDeposits] = useState('')
  const [note, setNote]         = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault(); setError('')
    const bal = Number(balance)
    if (!Number.isFinite(bal)) { setError('הזן יתרה'); return }
    setBusy(true)
    try {
      await axios.post(`/api/assets/${asset.id}/snapshots`, {
        snapshot_date: date, balance: bal,
        deposits: deposits === '' ? 0 : Number(deposits), note,
      })
      onSaved()
    } catch (err) {
      setError(err.response?.data?.error || 'שגיאה בשמירה')
    } finally { setBusy(false) }
  }

  return (
    <form onSubmit={submit} className="bg-gray-800/40 rounded-lg p-3 mt-2">
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-gray-400 mb-1">תאריך</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className={field} />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">יתרה ({CUR_SYMBOL[asset.currency]})</label>
          <input type="number" step="0.01" value={balance} onChange={e => setBalance(e.target.value)} className={`${field} w-32`} />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">הפקדות בתקופה (רשות)</label>
          <input type="number" step="0.01" value={deposits} onChange={e => setDeposits(e.target.value)}
            placeholder="0" className={`${field} w-32 placeholder-gray-500`} />
        </div>
        <div className="flex-1 min-w-[10rem]">
          <label className="block text-xs text-gray-400 mb-1">הערה (רשות)</label>
          <input type="text" value={note} dir="auto" onChange={e => setNote(e.target.value)} className={`${field} w-full`} />
        </div>
        <button type="submit" disabled={busy}
          className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          {busy ? 'שומר...' : 'שמור עדכון'}
        </button>
        <button type="button" onClick={onClose} className="text-gray-400 hover:text-white text-sm px-2 py-2">בטל</button>
      </div>
      {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
    </form>
  )
}

/** History list of all snapshots for one asset. */
function SnapshotHistory({ asset, onChanged }) {
  const [rows, setRows] = useState(null)

  async function load() {
    try {
      const res = await axios.get(`/api/assets/${asset.id}/snapshots`)
      setRows(res.data.snapshots)
    } catch { setRows([]) }
  }
  useEffect(() => { load() }, [asset.id])

  async function remove(sid) {
    if (!confirm('למחוק את העדכון הזה?')) return
    await axios.delete(`/api/assets/snapshots/${sid}`)
    await load()
    onChanged()
  }

  if (rows === null) return <div className="text-gray-400 text-sm mt-2">טוען היסטוריה...</div>
  if (rows.length === 0) return <div className="text-gray-500 text-sm mt-2">אין עדכונים עדיין.</div>

  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-gray-500 text-xs">
            <th className="text-right font-medium py-1">תאריך</th>
            <th className="text-right font-medium py-1">יתרה</th>
            <th className="text-right font-medium py-1">הפקדות</th>
            <th className="text-right font-medium py-1">שינוי</th>
            <th className="text-right font-medium py-1">הערה</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const prev = rows[i + 1]   // rows are newest-first
            const delta = prev ? r.balance - prev.balance : null
            return (
              <tr key={r.id} className="border-t border-gray-800">
                <td className="py-1.5 text-gray-300 font-mono">{r.snapshot_date}</td>
                <td className="py-1.5 text-white font-mono">{money(r.balance, asset.currency)}</td>
                <td className="py-1.5 text-gray-400 font-mono">{r.deposits ? money(r.deposits, asset.currency) : '—'}</td>
                <td className={`py-1.5 font-mono ${delta == null ? 'text-gray-600' : delta >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {delta == null ? '—' : `${delta >= 0 ? '+' : ''}${money(delta, asset.currency)}`}
                </td>
                <td className="py-1.5 text-gray-400" dir="auto">{r.note || ''}</td>
                <td className="py-1.5 text-left">
                  <button onClick={() => remove(r.id)} className="text-gray-600 hover:text-red-400" title="מחק עדכון">
                    <X className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** One asset/liability row with its actions (reorder / update / history / edit / delete). */
function AssetRow({ asset, isFirst, isLast, onMove, onChanged }) {
  const [mode, setMode] = useState(null)   // null | 'update' | 'history' | 'edit'
  const isLiability = asset.kind === 'liability'

  async function remove() {
    if (!confirm(`למחוק את "${asset.institution} — ${asset.asset_type}" וכל ההיסטוריה שלו?`)) return
    await axios.delete(`/api/assets/${asset.id}`)
    onChanged()
  }
  function afterSnapshot() { setMode('history'); onChanged() }
  function afterEdit() { setMode(null); onChanged() }

  return (
    <div className="bg-gray-900 rounded-xl p-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-2">
          {/* Reorder arrows — move within this section (assets / liabilities). */}
          <div className="flex flex-col -my-1">
            <button onClick={() => onMove(asset.id, 'up')} disabled={isFirst}
              className="text-gray-600 hover:text-white disabled:opacity-20 disabled:hover:text-gray-600" title="הזז למעלה">
              <ArrowUp className="w-4 h-4" />
            </button>
            <button onClick={() => onMove(asset.id, 'down')} disabled={isLast}
              className="text-gray-600 hover:text-white disabled:opacity-20 disabled:hover:text-gray-600" title="הזז למטה">
              <ArrowDown className="w-4 h-4" />
            </button>
          </div>
          <div className="min-w-[12rem]">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-white font-medium">{asset.institution}</span>
              <span className={`text-xs rounded px-1.5 py-0.5 ${isLiability ? 'text-red-400 bg-red-500/10' : 'text-blue-400 bg-blue-500/10'}`}>{asset.asset_type}</span>
              {asset.category && <span className="text-xs text-purple-300 bg-purple-500/10 rounded px-1.5 py-0.5">{asset.category}</span>}
              <span className="text-xs text-gray-500">{ownerLabel(asset.owner)}</span>
              {asset.currency !== 'ILS' && <span className="text-xs text-amber-400">{asset.currency}</span>}
            </div>
            {asset.label && <div className="text-xs text-gray-500 mt-0.5" dir="auto">{asset.label}</div>}
          </div>
        </div>
        <div className="text-right">
          <div className={`text-lg font-mono ${isLiability ? 'text-red-400' : 'text-white'}`}>
            {isLiability && asset.last_balance != null ? '−' : ''}{money(asset.last_balance, asset.currency)}
          </div>
          <div className="text-xs text-gray-500">
            {asset.last_date ? `נכון ל-${asset.last_date}` : 'טרם הוזנה יתרה'}
            {asset.last_deposits ? ` · הפקדות ${money(asset.last_deposits, asset.currency)}` : ''}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setMode(mode === 'update' ? null : 'update')}
            className="flex items-center gap-1 bg-green-600/90 hover:bg-green-600 text-white px-3 py-1.5 rounded-lg text-sm transition-colors">
            <TrendingUp className="w-4 h-4" /> עדכן יתרה
          </button>
          <button onClick={() => setMode(mode === 'history' ? null : 'history')}
            className="text-gray-400 hover:text-white p-2" title="היסטוריה"><History className="w-4 h-4" /></button>
          <button onClick={() => setMode(mode === 'edit' ? null : 'edit')}
            className="text-gray-400 hover:text-white p-2" title="עריכה"><Pencil className="w-4 h-4" /></button>
          <button onClick={remove} className="text-gray-500 hover:text-red-400 p-2" title="מחיקה"><Trash2 className="w-4 h-4" /></button>
        </div>
      </div>

      {mode === 'update' && <SnapshotForm asset={asset} onSaved={afterSnapshot} onClose={() => setMode(null)} />}
      {mode === 'history' && <SnapshotHistory asset={asset} onChanged={onChanged} />}
      {mode === 'edit' && (
        <div className="mt-3 border-t border-gray-800 pt-3">
          <AssetForm initial={asset} onSaved={afterEdit} onClose={() => setMode(null)} />
        </div>
      )}
    </div>
  )
}

/** Breakdown card: each row shows the amount, its share (%) of the card total,
 *  and a thin progress bar. Percentages are of the sum of this card's rows. */
function BreakdownCard({ title, rows, limit }) {
  const denom = rows.reduce((s, r) => s + r.total, 0)
  const shown = limit ? rows.slice(0, limit) : rows
  return (
    <div className="bg-gray-900 rounded-xl p-4">
      <div className="text-xs text-gray-400 mb-2">{title}</div>
      <div className="space-y-1.5">
        {shown.map(t => {
          const pct = denom > 0 ? (t.total / denom) * 100 : 0
          return (
            <div key={t.key}>
              <div className="flex justify-between text-xs">
                <span className="text-gray-300">{t.key}</span>
                <span className="font-mono text-gray-400">
                  {ils(t.total)} <span className="text-gray-500">· {pct.toFixed(1)}%</span>
                </span>
              </div>
              <div className="h-1 mt-0.5 bg-gray-800 rounded">
                <div className="h-1 bg-blue-500/70 rounded" style={{ width: `${pct}%` }} />
              </div>
            </div>
          )
        })}
        {rows.length === 0 && <span className="text-xs text-gray-600">אין נתונים</span>}
      </div>
    </div>
  )
}

/** A titled section (assets / liabilities) with its own rows and "add" button. */
function AssetSection({ title, kind, rows, onAdd, onMove, onChanged, emptyText }) {
  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold text-white">{title}</h3>
        <button onClick={onAdd}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors">
          <Plus className="w-4 h-4" /> {kind === 'liability' ? 'הוסף התחייבות' : 'הוסף נכס'}
        </button>
      </div>
      {rows.length === 0 ? (
        <div className="bg-gray-900 rounded-xl p-6 text-center text-gray-500 text-sm">{emptyText}</div>
      ) : (
        <div className="space-y-3">
          {rows.map((a, i) => (
            <AssetRow key={a.id} asset={a}
              isFirst={i === 0} isLast={i === rows.length - 1}
              onMove={onMove} onChanged={onChanged} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function AssetsPage() {
  const [assets, setAssets]   = useState([])
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [adding, setAdding]   = useState(null)   // null | 'asset' | 'liability'

  async function load() {
    try {
      const [a, s] = await Promise.all([
        axios.get('/api/assets'),
        axios.get('/api/assets/summary'),
      ])
      setAssets(a.data.assets)
      setSummary(s.data)
    } catch {
      setAssets([]); setSummary(null)
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  async function move(id, direction) {
    try { await axios.put(`/api/assets/${id}/move`, { direction }); await load() }
    catch { /* ignore — already at edge or transient */ }
  }

  if (loading) return <div className="text-gray-400">טוען נכסים...</div>

  const assetRows     = assets.filter(a => a.kind !== 'liability')
  const liabilityRows = assets.filter(a => a.kind === 'liability')

  return (
    <div className="max-w-4xl">
      <h2 className="text-xl font-bold text-white mb-6">מאזן נכסים פיננסיים</h2>

      {/* Summary cards — gross / liabilities / net */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          <div className="bg-gray-900 rounded-xl p-4">
            <div className="text-xs text-gray-400 mb-1">סך נכסים — ברוטו (₪)</div>
            <div className="text-2xl font-mono text-white">{ils(summary.gross)}</div>
            <div className="text-xs text-gray-500 mt-1">{summary.assetCount} נכסים</div>
          </div>
          <div className="bg-gray-900 rounded-xl p-4">
            <div className="text-xs text-gray-400 mb-1">סך התחייבויות (₪)</div>
            <div className="text-2xl font-mono text-red-400">{summary.totalLiabilities ? '−' : ''}{ils(summary.totalLiabilities)}</div>
            <div className="text-xs text-gray-500 mt-1">{summary.liabilityCount} התחייבויות</div>
          </div>
          <div className="bg-gray-900 rounded-xl p-4 ring-1 ring-blue-500/30">
            <div className="text-xs text-gray-400 mb-1">שווי נטו (₪)</div>
            <div className={`text-2xl font-mono ${summary.net >= 0 ? 'text-green-400' : 'text-red-400'}`}>{ils(summary.net)}</div>
            <div className="text-xs text-gray-500 mt-1">נכסים פחות התחייבויות</div>
          </div>
        </div>
      )}

      {/* Breakdown cards — by category and by type (assets only), with percentages */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
          <BreakdownCard title="פילוח לפי קטגוריה" rows={summary.byCategory} />
          <BreakdownCard title="פילוח לפי סוג" rows={summary.byType} limit={6} />
        </div>
      )}

      {adding && (
        <AssetForm defaultKind={adding}
          onSaved={() => { setAdding(null); load() }}
          onClose={() => setAdding(null)} />
      )}

      <AssetSection title="נכסים" kind="asset" rows={assetRows}
        onAdd={() => setAdding('asset')} onMove={move} onChanged={load}
        emptyText='עדיין לא הוזנו נכסים. לחץ "הוסף נכס" כדי להתחיל.' />

      <AssetSection title="התחייבויות" kind="liability" rows={liabilityRows}
        onAdd={() => setAdding('liability')} onMove={move} onChanged={load}
        emptyText='אין התחייבויות. ניתן להוסיף הלוואות (למשל הלוואת בנק) עם עדכון יתרה ידני.' />

      <p className="text-xs text-gray-600 mt-2">
        הנתונים מוזנים ידנית. מומלץ לעדכן את היתרות אחת לחודש (כפתור "עדכן יתרה" בכל שורה).
        הברוטו הוא סך הנכסים; הנטו מנכה מהם את ההתחייבויות.
      </p>
    </div>
  )
}
