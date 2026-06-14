import { useState, useEffect } from 'react'
import { ArrowLeftRight } from 'lucide-react'
import axios from 'axios'
import { ils } from './colors.js'

/**
 * Banner that surfaces suggested internal-transfer pairs (same amount, opposite
 * sign, different accounts, a few days apart). The user confirms each pair before
 * anything is removed from totals — "mark" flags both legs, "not a transfer"
 * dismisses the pair for good.
 */
export default function TransfersReview({ onChange }) {
  const [pairs, setPairs] = useState([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  async function loadCandidates() {
    try { const r = await axios.get('/api/transfers/candidates'); setPairs(r.data.pairs || []) }
    catch { setPairs([]) }
  }
  useEffect(() => { loadCandidates() }, [])

  async function mark(p) {
    setBusy(true)
    try {
      await axios.post('/api/transfers/mark', { a_id: p.a_id, b_id: p.b_id })
      await loadCandidates(); onChange?.()
    } finally { setBusy(false) }
  }
  async function ignore(p) {
    setBusy(true)
    try { await axios.post('/api/transfers/ignore', { a_id: p.a_id, b_id: p.b_id }); await loadCandidates() }
    finally { setBusy(false) }
  }

  if (pairs.length === 0) return null

  return (
    <div className="bg-blue-500/5 border border-blue-500/30 rounded-xl p-4 mb-4">
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2 text-blue-300 text-sm font-medium">
        <ArrowLeftRight className="w-4 h-4" />
        נמצאו {pairs.length} העברות אפשריות בין חשבונות — לחץ לסקירה
      </button>
      {open && (
        <div className="mt-3 space-y-2">
          {pairs.map(p => (
            <div key={`${p.a_id}-${p.b_id}`} className="bg-gray-900 rounded-lg p-3 flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm text-gray-300">
                <span className="font-mono text-white">{ils(Math.abs(p.amount))}</span>
                <span className="text-gray-500"> · </span>
                <span>{p.a_account} <span className="text-gray-600">({p.a_date})</span></span>
                <ArrowLeftRight className="inline w-3.5 h-3.5 mx-1.5 text-gray-500" />
                <span>{p.b_account} <span className="text-gray-600">({p.b_date})</span></span>
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => mark(p)} disabled={busy}
                  className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-xs font-medium">
                  סמן כהעברה
                </button>
                <button onClick={() => ignore(p)} disabled={busy}
                  className="text-gray-400 hover:text-white px-2 py-1.5 text-xs">
                  לא העברה
                </button>
              </div>
            </div>
          ))}
          <p className="text-xs text-gray-500">סימון כהעברה מסיר את שתי הרגליים מכל החישובים (הכנסות, הוצאות, תקציב).</p>
        </div>
      )}
    </div>
  )
}
