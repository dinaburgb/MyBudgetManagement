import { useState, useEffect } from 'react'
import { Plus, Trash2, Edit2, CheckCircle, XCircle, Building2, RefreshCw } from 'lucide-react'
import axios from 'axios'

const SOURCES = [
  'hapoalim', 'discount', 'fibi', 'mizrahi', 'onezero',
  'isracard', 'cal', 'max'
]

const SOURCE_LABELS = {
  hapoalim: 'Bank Hapoalim',
  discount:  'Bank Discount',
  fibi:      'FIBI (Beinleumi)',
  mizrahi:   'Mizrahi Tefahot',
  onezero:   'OneZero',
  isracard:  'Isracard',
  cal:       'Visa Cal',
  max:       'Max',
}

// Which fields each source needs
const CREDENTIAL_FIELDS = {
  hapoalim:  [{ key: 'userCode',  label: 'User Code' }, { key: 'password', label: 'Password', secret: true }],
  discount:  [{ key: 'id',        label: 'ID Number' }, { key: 'password', label: 'Password', secret: true }, { key: 'num', label: 'User Code' }],
  fibi:      [{ key: 'username',  label: 'Username'  }, { key: 'password', label: 'Password', secret: true }],
  mizrahi:   [{ key: 'username',  label: 'Username'  }, { key: 'password', label: 'Password', secret: true }],
  onezero:   [{ key: 'email',     label: 'Email'     }, { key: 'password', label: 'Password', secret: true }],
  isracard:  [{ key: 'id',        label: 'ID Number' }, { key: 'card6Digits', label: 'Card 6 digits' }, { key: 'password', label: 'Password', secret: true }],
  cal:       [{ key: 'username',  label: 'Username'  }, { key: 'password', label: 'Password', secret: true }],
  max:       [{ key: 'username',  label: 'Username'  }, { key: 'password', label: 'Password', secret: true }],
}

function AccountForm({ initial, onSave, onCancel }) {
  const [name,   setName]   = useState(initial?.name   || '')
  const [source, setSource] = useState(initial?.source || 'hapoalim')
  const [owner,  setOwner]  = useState(initial?.owner  || 'Boris')
  const [creds,  setCreds]  = useState({})
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  const fields = CREDENTIAL_FIELDS[source] || []

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    // Validate all credential fields are filled
    for (const f of fields) {
      if (!creds[f.key]) {
        setError(`Please fill in: ${f.label}`)
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
      setError(err.response?.data?.error || 'Failed to save account')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-gray-800 rounded-xl p-5 space-y-4">
      <h3 className="font-semibold text-white">
        {initial ? 'Edit Account' : 'Add New Account'}
      </h3>

      {/* Source */}
      <div>
        <label className="block text-sm text-gray-400 mb-1">Bank / Card</label>
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
        <label className="block text-sm text-gray-400 mb-1">Display Name (optional)</label>
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
        <label className="block text-sm text-gray-400 mb-1">Owner</label>
        <select
          value={owner}
          onChange={e => setOwner(e.target.value)}
          className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="Boris">Boris</option>
          <option value="Irena">Irena</option>
          <option value="Joint">Joint</option>
        </select>
      </div>

      {/* Credential fields */}
      <div className="space-y-3">
        <p className="text-sm text-gray-400 font-medium">Login Credentials</p>
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
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-medium py-2 rounded-lg transition-colors"
        >
          Cancel
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

  async function handleDelete(id) {
    if (!confirm('Delete this account? This will NOT delete its transactions.')) return
    await axios.delete(`/api/accounts/${id}`)
    load()
  }

  function handleSaved() {
    setShowForm(false)
    setEditing(null)
    load()
  }

  // Which account is currently syncing, and the last result message
  const [syncingId, setSyncingId] = useState(null)
  const [syncMsg, setSyncMsg]     = useState(null)  // { id, text, ok }

  async function handleSync(acc) {
    setSyncingId(acc.id)
    setSyncMsg(null)
    try {
      const res = await axios.post(`/api/scrape/account/${acc.id}`)
      const s = res.data.stats || {}
      setSyncMsg({
        id: acc.id, ok: true,
        text: `Done — ${s.inserted} new, ${s.updated} updated, ${s.skipped} unchanged`,
      })
      load()
    } catch (err) {
      setSyncMsg({
        id: acc.id, ok: false,
        text: err.response?.data?.error || 'Sync failed',
      })
    } finally {
      setSyncingId(null)
    }
  }

  if (loading) return <div className="text-gray-400">Loading accounts...</div>

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-white">Bank Accounts & Cards</h2>
        <button
          onClick={() => { setShowForm(true); setEditing(null) }}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Account
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
          <p>No accounts yet. Click "Add Account" to get started.</p>
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
                  <div className="font-medium text-white">{acc.name}</div>
                  <div className="text-sm text-gray-400 mt-0.5">
                    {SOURCE_LABELS[acc.source]} · {acc.owner}
                    {acc.last_scraped && (
                      <span className="ml-3 text-gray-500">
                        Last synced: {new Date(acc.last_scraped).toLocaleString()}
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
                    {syncingId === acc.id ? 'Syncing...' : 'Update'}
                  </button>
                  <button
                    onClick={() => { setEditing(acc); setShowForm(false) }}
                    className="text-gray-400 hover:text-white transition-colors"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(acc.id)}
                    className="text-gray-400 hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Sync result message for this account */}
              {syncMsg?.id === acc.id && (
                <div className={`mt-3 text-sm rounded-lg px-3 py-2 ${
                  syncMsg.ok ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
                }`}>
                  {syncMsg.text}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
