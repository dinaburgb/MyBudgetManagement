import { useState } from 'react'
import axios from 'axios'

function todayYMD() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Add a transaction by hand (e.g. a cash payment). Amount is entered positive;
 * the expense/income toggle decides the sign before posting.
 */
export default function ManualTxnForm({ accounts, categories, owners, onAdded, onClose }) {
  const [date, setDate] = useState(todayYMD())
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [kind, setKind] = useState('expense')         // 'expense' | 'income'
  const [category, setCategory] = useState(categories[0] || 'אחר')
  const [owner, setOwner] = useState(owners[0] || 'Boris')
  const [accountId, setAccountId] = useState('')      // '' = cash / no account
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault(); setError('')
    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt <= 0) { setError('הזן סכום חיובי'); return }
    if (!description.trim()) { setError('הזן תיאור'); return }
    const signed = kind === 'expense' ? -Math.abs(amt) : Math.abs(amt)
    setBusy(true)
    try {
      await axios.post('/api/transactions', {
        date, description: description.trim(), amount: signed,
        category, owner, account_id: accountId || null,
      })
      onAdded()
    } catch (err) {
      setError(err.response?.data?.error || 'שגיאה בהוספה')
    } finally { setBusy(false) }
  }

  const field = 'bg-gray-800 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500'

  return (
    <form onSubmit={submit} className="bg-gray-900 rounded-xl p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-white font-medium">הוספת תנועה ידנית (למשל מזומן)</h3>
        <button type="button" onClick={onClose} className="text-gray-400 hover:text-white text-sm">סגור ✕</button>
      </div>
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-gray-400 mb-1">תאריך</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className={field} />
        </div>
        <div className="flex-1 min-w-[12rem]">
          <label className="block text-xs text-gray-400 mb-1">תיאור</label>
          <input type="text" value={description} onChange={e => setDescription(e.target.value)} dir="auto"
                 placeholder="למשל: קנייה בשוק" className={`${field} w-full placeholder-gray-500`} />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">סכום (₪)</label>
          <input type="number" step="0.01" min="0" value={amount} onChange={e => setAmount(e.target.value)} className={`${field} w-28`} />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">סוג</label>
          <select value={kind} onChange={e => setKind(e.target.value)} className={field}>
            <option value="expense">הוצאה</option>
            <option value="income">הכנסה</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">קטגוריה</label>
          <select value={category} onChange={e => setCategory(e.target.value)} className={field}>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">בעלים</label>
          <select value={owner} onChange={e => setOwner(e.target.value)} className={field}>
            {owners.map(o => <option key={o} value={o}>{o}</option>)}
            {owners.length === 0 && <option value="Boris">Boris</option>}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">חשבון</label>
          <select value={accountId} onChange={e => setAccountId(e.target.value)} className={field}>
            <option value="">מזומן / ללא חשבון</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <button type="submit" disabled={busy}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          {busy ? 'מוסיף...' : 'הוסף'}
        </button>
      </div>
      {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
    </form>
  )
}
