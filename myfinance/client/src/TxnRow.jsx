import { useState } from 'react'
import axios from 'axios'
import { ils } from './colors.js'
import { useCategories } from './CategoriesContext.jsx'
import NoteEditor from './NoteEditor.jsx'

/**
 * One compact transaction row for the drill-down lists (Overview, Budgets).
 * The category is editable inline from here too, so a charge can be re-filed from
 * anywhere a transaction is shown. onChanged() lets the parent refresh its totals
 * after a category change (the row may leave the bucket being viewed).
 */
export default function TxnRow({ txn, showAccount = true, onChanged }) {
  const { names } = useCategories()
  const [cat,  setCat]  = useState(txn.category)
  const [note, setNote] = useState(txn.note)

  async function changeCategory(next) {
    if (next === cat) return
    setCat(next)
    try {
      await axios.put(`/api/transactions/${txn.id}/category`, { category: next })
      onChanged?.(txn.id, next)
    } catch {
      setCat(txn.category)  // revert on failure
    }
  }

  return (
    <tr className="border-b border-gray-800/50">
      <td className="py-2 pl-2 text-gray-500 whitespace-nowrap align-top text-xs">{txn.date}</td>
      <td className="py-2 align-top">
        <div className="text-white text-sm truncate max-w-[14rem]" dir="auto">{txn.description}</div>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          {txn.type === 'installment' && txn.installment_total > 1 && (
            <span className="text-[11px] text-amber-400 bg-amber-500/10 rounded px-1.5 py-0.5">
              תשלום {txn.installment_number}/{txn.installment_total}
            </span>
          )}
          {showAccount && txn.account_name && (
            <span className="text-gray-600 text-[11px]">{txn.account_name}</span>
          )}
        </div>
        <div className="mt-1">
          <NoteEditor id={txn.id} note={note} onSaved={setNote} />
        </div>
      </td>
      <td className="py-2 align-top">
        <select
          value={cat || 'אחר'}
          onChange={e => changeCategory(e.target.value)}
          className="bg-gray-800 text-gray-300 rounded px-1.5 py-1 text-xs outline-none max-w-[7.5rem]"
        >
          {!names.includes(cat) && cat && <option value={cat}>{cat}</option>}
          {names.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </td>
      <td className={`py-2 pr-2 text-left font-mono whitespace-nowrap align-top text-xs ${txn.amount < 0 ? 'text-red-400' : 'text-green-400'}`}>
        {txn.amount < 0 ? '-' : '+'}{ils(Math.abs(txn.amount))}
      </td>
    </tr>
  )
}
