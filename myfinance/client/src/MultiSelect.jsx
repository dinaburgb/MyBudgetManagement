import { useState, useRef, useEffect } from 'react'
import { ChevronDown } from 'lucide-react'

/**
 * Compact multi-select dropdown with checkboxes. `options` is [{ value, label }];
 * `selected` is an array of values; `onChange` receives the new array.
 */
export default function MultiSelect({ label, options, selected, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const sel = new Set(selected)
  function toggle(v) {
    const n = new Set(sel)
    n.has(v) ? n.delete(v) : n.add(v)
    onChange([...n])
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 bg-gray-900 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
      >
        {selected.length === 0 ? label : `${label} (${selected.length})`}
        <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 right-0 bg-gray-800 border border-gray-700 rounded-lg p-1.5 max-h-64 overflow-y-auto min-w-[12rem] shadow-xl">
          {options.length === 0 ? (
            <div className="text-gray-500 text-xs px-2 py-1">אין אפשרויות</div>
          ) : (
            options.map(o => (
              <label key={o.value} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-700 cursor-pointer text-sm text-gray-200">
                <input type="checkbox" checked={sel.has(o.value)} onChange={() => toggle(o.value)} className="w-4 h-4 accent-blue-600" />
                {o.label}
              </label>
            ))
          )}
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="w-full text-center text-xs text-gray-400 hover:text-white mt-1 py-1 border-t border-gray-700"
            >
              נקה בחירה
            </button>
          )}
        </div>
      )}
    </div>
  )
}
