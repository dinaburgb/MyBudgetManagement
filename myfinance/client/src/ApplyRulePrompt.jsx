import { useState } from 'react'
import axios from 'axios'

/**
 * Shown right after a transaction's category is changed: offers to turn the
 * change into a rule that applies to all similar transactions (and future ones).
 * The keyword is pre-filled with the description but editable, since a raw
 * description is often too specific (e.g. it carries a unique reference id).
 */
export default function ApplyRulePrompt({ description, category, onApplied, onClose }) {
  const [kw, setKw]   = useState((description || '').trim())
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)   // applied count, after success

  async function apply() {
    if (!kw.trim()) return
    setBusy(true)
    try {
      const res = await axios.post('/api/categories/rules', {
        keyword: kw.trim(), category, applyMode: 'all',
      })
      setDone(res.data.applied || 0)
      onApplied?.(res.data.applied || 0)
    } finally {
      setBusy(false)
    }
  }

  if (done != null) {
    return (
      <div className="mt-1.5 bg-gray-800 border border-gray-700 rounded-lg p-2 text-xs text-emerald-400 flex items-center justify-between gap-2">
        <span>נוצר כלל — {done} תנועות סווגו ל"{category}".</span>
        <button onClick={onClose} className="text-gray-400 hover:text-white">סגור</button>
      </div>
    )
  }

  return (
    <div className="mt-1.5 bg-gray-800 border border-gray-700 rounded-lg p-2 text-xs">
      <div className="text-gray-300 mb-1.5">להחיל גם על כל התנועות שמכילות:</div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <input
          value={kw}
          onChange={e => setKw(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') apply(); if (e.key === 'Escape') onClose?.() }}
          dir="auto"
          autoFocus
          className="bg-gray-700 text-white rounded px-2 py-1 outline-none focus:ring-2 focus:ring-blue-500 w-44"
        />
        <span className="text-gray-500">← {category}</span>
        <button onClick={apply} disabled={busy} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-2 py-1 rounded font-medium">
          {busy ? 'מחיל…' : 'החל על כולן'}
        </button>
        <button onClick={onClose} className="text-gray-400 hover:text-white px-1.5 py-1">לא, רק זו</button>
      </div>
    </div>
  )
}
