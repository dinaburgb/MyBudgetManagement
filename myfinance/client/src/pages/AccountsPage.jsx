import { useState, useEffect } from 'react'
import { Plus, Trash2, Edit2, CheckCircle, XCircle, Building2, RefreshCw } from 'lucide-react'
import axios from 'axios'
import { ils } from '../colors.js'

const SOURCES = [
  'hapoalim', 'discount', 'fibi', 'mizrahi', 'onezero',
  'isracard', 'cal', 'max'
]

const SOURCE_LABELS = {
  hapoalim: 'בנק הפועלים',
  discount: 'בנק דיסקונט',
  fibi:     'הבינלאומי (FIBI)',
  mizrahi:  'מזרחי טפחות',
  onezero:  'וואן זירו',
  isracard: 'ישראכרט',
  cal:      'ויזה כאל',
  max:      'מקס',
}

// Which fields each source needs
const CREDENTIAL_FIELDS = {
  hapoalim:  [{ key: 'userCode',  label: 'קוד משתמש' }, { key: 'password', label: 'סיסמה', secret: true }],
  discount:  [{ key: 'id',        label: 'תעודת זהות' }, { key: 'password', label: 'סיסמה', secret: true }, { key: 'num', label: 'קוד משתמש' }],
  fibi:      [{ key: 'username',  label: 'שם משתמש'  }, { key: 'password', label: 'סיסמה', secret: true }],
  mizrahi:   [{ key: 'username',  label: 'שם משתמש'  }, { key: 'password', label: 'סיסמה', secret: true }],
  onezero:   [{ key: 'email',     label: 'אימייל'    }, { key: 'password', label: 'סיסמה', secret: true }],
  isracard:  [{ key: 'id',        label: 'תעודת זהות' }, { key: 'card6Digits', label: '6 ספרות בכרטיס' }, { key: 'password', label: 'סיסמה', secret: true }],
  cal:       [{ key: 'username',  label: 'שם משתמש'  }, { key: 'password', label: 'סיסמה', secret: true }],
  max:       [{ key: 'username',  label: 'שם משתמש'  }, { key: 'password', label: 'סיסמה', secret: true }],
}

const PRESET_OWNERS = ['Boris', 'Irena', 'Joint']

function AccountForm({ initial, onSave, onCancel }) {
  const [name,   setName]   = useState(initial?.name   || '')
  const [source, setSource] = useState(initial?.source || 'hapoalim')
  // Owner can be a preset (Boris/Irena/Joint) or a custom name via "Other".
  const initialOwner = initial?.owner || 'Boris'
  const initialIsPreset = PRESET_OWNERS.includes(initialOwner)
  const [ownerSelect, setOwnerSelect] = useState(initialIsPreset ? initialOwner : 'Other')
  const [customOwner, setCustomOwner] = useState(initialIsPreset ? '' : initialOwner)
  // The effective owner value that gets saved
  const owner = ownerSelect === 'Other' ? customOwner.trim() : ownerSelect
  const [creds,  setCreds]  = useState({})
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  const fields = CREDENTIAL_FIELDS[source] || []

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (ownerSelect === 'Other' && !customOwner.trim()) {
      setError('נא להזין שם בעלים')
      return
    }

    for (const f of fields) {
      if (!creds[f.key]) {
        setError(`נא למלא: ${f.label}`)
        return
      }
    }

    setSaving(true)
    try {
      const payload = {
        name: name || SOURCE_LABELS[source],
        source,
        owner,
        credentials: JSON.stringify(creds),
      }
      if (initial?.id) {
        await axios.put(`/api/accounts/${initial.id}`, payload)
      } else {
        await axios.post('/api/accounts', payload)
      }
      onSave()
    } catch (err) {
      setError(err.response?.data?.error || 'שמירת החשבון נכשלה')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-gray-800 rounded-xl p-5 space-y-4">
      <h3 className="font-semibold text-white">
        {initial ? 'עריכת חשבון' : 'הוספת חשבון חדש'}
      </h3>

      {/* Source */}
      <div>
        <label className="block text-sm text-gray-400 mb-1">בנק / כרטיס</label>
        <select
          value={source}
          onChange={e => { setSource(e.target.value); setCreds({}) }}
          className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
        >
          {SOURCES.map(s => (
            <option key={s} value={s}>{SOURCE_LABELS[s]}</option>
          ))}
        </select>
      </div>

      {/* Display name */}
      <div>
        <label className="block text-sm text-gray-400 mb-1">שם תצוגה (לא חובה)</label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder={SOURCE_LABELS[source]}
          className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
        />
      </div>

      {/* Owner */}
      <div>
        <label className="block text-sm text-gray-400 mb-1">בעלים</label>
        <select
          value={ownerSelect}
          onChange={e => setOwnerSelect(e.target.value)}
          className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="Boris">Boris</option>
          <option value="Irena">Irena</option>
          <option value="Joint">משותף</option>
          <option value="Other">אחר…</option>
        </select>
        {ownerSelect === 'Other' && (
          <input
            type="text"
            value={customOwner}
            onChange={e => setCustomOwner(e.target.value)}
            placeholder="הזן שם בעלים"
            className="w-full mt-2 bg-gray-700 text-white rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
          />
        )}
      </div>

      {/* Credential fields */}
      <div className="space-y-3">
        <p className="text-sm text-gray-400 font-medium">פרטי התחברות</p>
        {fields.map(f => (
          <div key={f.key}>
            <label className="block text-sm text-gray-400 mb-1">{f.label}</label>
            <input
              type={f.secret ? 'password' : 'text'}
              value={creds[f.key] || ''}
              onChange={e => setCreds(prev => ({ ...prev, [f.key]: e.target.value }))}
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
              autoComplete="off"
            />
          </div>
        ))}
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={saving}
          className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-2 rounded-lg transition-colors"
        >
          {saving ? 'שומר...' : 'שמירה'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-medium py-2 rounded-lg transition-colors"
        >
          ביטול
        </button>
      </div>
    </form>
  )
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing,  setEditing]  = useState(null)

  async function load() {
    try {
      const res = await axios.get('/api/accounts')
      setAccounts(res.data)
    } catch {
      // will show empty state
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  // Which account is awaiting a delete/clean confirmation
  const [confirmId, setConfirmId] = useState(null)

  // Remove an account. withData=true also deletes its transactions & balances
  // ("clean account"), so nothing from it appears anywhere.
  async function removeAccount(id, withData) {
    await axios.delete(`/api/accounts/${id}`, { params: withData ? { withData: 1 } : {} })
    setConfirmId(null)
    load()
  }

  function handleSaved() {
    setShowForm(false)
    setEditing(null)
    load()
  }

  // Which account is currently syncing, and the last result message
  const [syncingId, setSyncingId] = useState(null)
  const [syncMsg, setSyncMsg]     = useState(null)

  // Toggle whether this account is included in totals/summaries
  async function toggleInTotals(acc) {
    const next = acc.include_in_totals ? 0 : 1
    setAccounts(prev => prev.map(a => a.id === acc.id ? { ...a, include_in_totals: next } : a))
    try {
      await axios.put(`/api/accounts/${acc.id}`, { include_in_totals: next })
    } catch {
      load()
    }
  }

  async function handleSync(acc) {
    setSyncingId(acc.id)
    setSyncMsg(null)
    try {
      const res = await axios.post(`/api/scrape/account/${acc.id}`)
      const s = res.data.stats || {}
      setSyncMsg({
        id: acc.id, ok: true,
        text: `הסתיים — ${s.inserted} חדשות, ${s.updated} עודכנו, ${s.skipped} ללא שינוי`,
        accountsCount: s.accountsCount,
        breakdown: s.breakdown || [],
      })
      load()
    } catch (err) {
      setSyncMsg({
        id: acc.id, ok: false,
        text: err.response?.data?.error || 'הסנכרון נכשל',
      })
    } finally {
      setSyncingId(null)
    }
  }

  if (loading) return <div className="text-gray-400">טוען חשבונות...</div>

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-white">חשבונות וכרטיסים</h2>
        <button
          onClick={() => { setShowForm(true); setEditing(null) }}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          הוספת חשבון
        </button>
      </div>

      {/* Add / edit form */}
      {(showForm || editing) && (
        <div className="mb-6">
          <AccountForm
            initial={editing}
            onSave={handleSaved}
            onCancel={() => { setShowForm(false); setEditing(null) }}
          />
        </div>
      )}

      {/* Account list */}
      {accounts.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <Building2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>אין עדיין חשבונות. לחץ על "הוספת חשבון" כדי להתחיל.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {accounts.map(acc => (
            <div
              key={acc.id}
              className="bg-gray-900 rounded-xl p-4"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-3">
                    <span className="font-medium text-white">{acc.name}</span>
                    {acc.balance != null && (
                      <span className={`font-mono text-sm ${acc.balance < 0 ? 'text-red-400' : 'text-green-400'}`}>
                        יתרה: {ils(acc.balance)}
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-gray-400 mt-0.5">
                    {SOURCE_LABELS[acc.source]} · {acc.owner}
                    {acc.last_scraped && (
                      <span className="mr-3 text-gray-500">
                        סונכרן לאחרונה: {new Date(acc.last_scraped).toLocaleString('he-IL')}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {acc.enabled
                    ? <CheckCircle className="w-4 h-4 text-green-500" />
                    : <XCircle className="w-4 h-4 text-gray-600" />
                  }
                  {/* Update / sync button */}
                  <button
                    onClick={() => handleSync(acc)}
                    disabled={syncingId === acc.id}
                    className="flex items-center gap-1.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
                  >
                    <RefreshCw className={`w-4 h-4 ${syncingId === acc.id ? 'animate-spin' : ''}`} />
                    {syncingId === acc.id ? 'מסנכרן...' : 'עדכון'}
                  </button>
                  <button
                    onClick={() => { setEditing(acc); setShowForm(false) }}
                    className="text-gray-400 hover:text-white transition-colors"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setConfirmId(confirmId === acc.id ? null : acc.id)}
                    className="text-gray-400 hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Include-in-totals toggle */}
              <label className="flex items-center gap-2 mt-3 text-sm text-gray-400 cursor-pointer select-none w-fit">
                <input
                  type="checkbox"
                  checked={!!acc.include_in_totals}
                  onChange={() => toggleInTotals(acc)}
                  className="w-4 h-4 accent-blue-600"
                />
                כלול בחישובים ובסיכומים
                {!acc.include_in_totals && (
                  <span className="text-amber-500/80 text-xs">(לא נכלל)</span>
                )}
              </label>

              {/* Delete / clean confirmation */}
              {confirmId === acc.id && (
                <div className="mt-3 bg-gray-800 rounded-lg p-3">
                  <p className="text-sm text-gray-300 mb-3">
                    מה לעשות עם החשבון "{acc.name}"?
                    {acc.txn_count > 0 && (
                      <span className="text-gray-400"> ({acc.txn_count} תנועות שמורות)</span>
                    )}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => removeAccount(acc.id, true)}
                      className="bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
                    >
                      נקה הכול{acc.txn_count > 0 ? ` (כולל ${acc.txn_count} תנועות)` : ''}
                    </button>
                    <button
                      onClick={() => removeAccount(acc.id, false)}
                      className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
                    >
                      הסר חשבון בלבד (שמור תנועות)
                    </button>
                    <button
                      onClick={() => setConfirmId(null)}
                      className="text-gray-400 hover:text-white px-3 py-1.5 text-sm transition-colors"
                    >
                      ביטול
                    </button>
                  </div>
                </div>
              )}

              {/* Sync result message for this account */}
              {syncMsg?.id === acc.id && (
                <div className={`mt-3 text-sm rounded-lg px-3 py-2 ${
                  syncMsg.ok ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
                }`}>
                  <div>{syncMsg.text}</div>
                  {/* Per-account breakdown so you can confirm every account synced */}
                  {syncMsg.ok && syncMsg.accountsCount > 0 && (
                    <div className="mt-2 text-gray-400">
                      <div className="text-gray-300 font-medium">
                        {syncMsg.accountsCount} חשבונות תחת התחברות זו:
                      </div>
                      <ul className="mt-1 space-y-0.5">
                        {syncMsg.breakdown.map(b => (
                          <li key={b.accountNumber} className="font-mono text-xs">
                            • {b.accountNumber} — {b.total} תנועות
                            {b.inserted > 0 && <span className="text-green-400"> ({b.inserted} חדשות)</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
