import { useState } from 'react'
import { StickyNote, Check, X, Pencil } from 'lucide-react'
import axios from 'axios'

/**
 * Inline note editor for a single transaction. Shows the existing note (or a
 * subtle "add note" hint), opens a small input on click, and saves via
 * PUT /api/transactions/:id/note. Calls onSaved(newNote) so the parent list can
 * update its own copy of the row.
 */
export default function NoteEditor({ id, note, onSaved }) {
  const [editing, setEditing] = useState(false)
  const [value,   setValue]   = useState(note || '')
  const [saving,  setSaving]  = useState(false)

  async function save() {
    setSaving(true)
    try {
      const res = await axios.put(`/api/transactions/${id}/note`, { note: value.trim() })
      onSaved?.(res.data.note)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  function cancel() { setValue(note || ''); setEditing(false) }

  if (editing) {
    return (
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel() }}
          placeholder="הערה…"
          autoFocus
          dir="auto"
          className="bg-gray-700 text-white rounded px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-blue-500 w-40 placeholder-gray-500"
        />
        <button onClick={save} disabled={saving} className="text-green-400 hover:text-green-300 disabled:opacity-50"><Check className="w-4 h-4" /></button>
        <button onClick={cancel} className="text-gray-400 hover:text-white"><X className="w-4 h-4" /></button>
      </div>
    )
  }

  // Has a note → show it with an edit pencil; empty → a subtle "add note" button.
  return note ? (
    <button
      onClick={() => setEditing(true)}
      className="group flex items-start gap-1.5 text-right text-amber-300/90 hover:text-amber-200"
      title="ערוך הערה"
    >
      <StickyNote className="w-3.5 h-3.5 mt-0.5 shrink-0" />
      <span className="text-xs break-words" dir="auto">{note}</span>
      <Pencil className="w-3 h-3 mt-0.5 opacity-0 group-hover:opacity-60 shrink-0" />
    </button>
  ) : (
    <button
      onClick={() => setEditing(true)}
      className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-300"
      title="הוסף הערה"
    >
      <StickyNote className="w-3.5 h-3.5" /> הוסף הערה
    </button>
  )
}
