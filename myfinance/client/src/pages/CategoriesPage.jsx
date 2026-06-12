import { useState, useEffect } from 'react'
import { Plus, Trash2, Tag, Wand2, Pencil, Check, X, FolderPlus } from 'lucide-react'
import axios from 'axios'
import { ils } from '../colors.js'
import { useCategories } from '../CategoriesContext.jsx'

// --- Manage the category list (add / rename / recolor / delete) ---
function CategoryManager({ onChanged }) {
  const { categories, reload } = useCategories()
  const [newName,  setNewName]  = useState('')
  const [newColor, setNewColor] = useState('#60a5fa')
  const [error,    setError]    = useState('')
  const [editId,   setEditId]   = useState(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('#60a5fa')

  async function refresh() { await reload(); onChanged?.() }

  async function add(e) {
    e.preventDefault()
    setError('')
    if (!newName.trim()) return
    try {
      await axios.post('/api/categories', { name: newName.trim(), color: newColor })
      setNewName('')
      refresh()
    } catch (err) {
      setError(err.response?.data?.error || 'שגיאה בהוספה')
    }
  }

  function startEdit(c) { setEditId(c.id); setEditName(c.name); setEditColor(c.color || '#60a5fa'); setError('') }

  async function saveEdit() {
    setError('')
    try {
      await axios.put(`/api/categories/${editId}`, { name: editName.trim(), color: editColor })
      setEditId(null)
      refresh()
    } catch (err) {
      setError(err.response?.data?.error || 'שגיאה בעדכון')
    }
  }

  async function remove(c) {
    if (!confirm(`למחוק את הקטגוריה "${c.name}"? התנועות שלה יעברו ל"אחר".`)) return
    setError('')
    try {
      await axios.delete(`/api/categories/${c.id}`)
      refresh()
    } catch (err) {
      setError(err.response?.data?.error || 'שגיאה במחיקה')
    }
  }

  return (
    <div className="bg-gray-900 rounded-xl p-5 mb-6">
      <div className="flex items-center gap-2 mb-3 text-white font-medium">
        <FolderPlus className="w-4 h-4" /> ניהול קטגוריות
      </div>

      {/* Add a category */}
      <form onSubmit={add} className="flex flex-wrap gap-2 items-center mb-4">
        <input
          type="color"
          value={newColor}
          onChange={e => setNewColor(e.target.value)}
          className="w-9 h-9 rounded bg-gray-800 border border-gray-700 cursor-pointer"
          title="צבע"
        />
        <input
          type="text"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder="שם קטגוריה חדשה (למשל: מתנות)"
          className="flex-1 min-w-[12rem] bg-gray-800 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
        />
        <button type="submit" className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors">
          <Plus className="w-4 h-4" /> הוסף
        </button>
      </form>

      {error && <p className="text-red-400 text-sm mb-3">{error}</p>}

      {/* Category list */}
      <div className="flex flex-wrap gap-2">
        {categories.map(c => (
          editId === c.id ? (
            <div key={c.id} className="flex items-center gap-1.5 bg-gray-800 rounded-lg px-2 py-1.5">
              <input type="color" value={editColor} onChange={e => setEditColor(e.target.value)}
                     className="w-6 h-6 rounded bg-gray-700 border border-gray-600 cursor-pointer" />
              <input type="text" value={editName} onChange={e => setEditName(e.target.value)}
                     onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditId(null) }}
                     className="bg-gray-700 text-white rounded px-2 py-1 text-sm outline-none w-28" autoFocus />
              <button onClick={saveEdit} className="text-green-400 hover:text-green-300"><Check className="w-4 h-4" /></button>
              <button onClick={() => setEditId(null)} className="text-gray-400 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
          ) : (
            <div key={c.id} className="flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-1.5 group">
              <span className="w-3 h-3 rounded-full" style={{ background: c.color || '#94a3b8' }} />
              <span className="text-white text-sm">{c.name}</span>
              {c.is_system ? (
                <span className="text-gray-600 text-xs">(מערכת)</span>
              ) : (
                <>
                  <button onClick={() => startEdit(c)} className="text-gray-500 hover:text-white"><Pencil className="w-3.5 h-3.5" /></button>
                  <button onClick={() => remove(c)} className="text-gray-500 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                </>
              )}
            </div>
          )
        ))}
      </div>
    </div>
  )
}

export default function CategoriesPage() {
  const { names, reload } = useCategories()
  const [rules,   setRules]   = useState([])
  const [summary, setSummary] = useState([])
  const [loading, setLoading] = useState(true)

  // New-rule form state
  const [keyword,  setKeyword]  = useState('')
  const [category, setCategory] = useState('')
  const [adding,   setAdding]   = useState(false)
  const [ruleMsg,  setRuleMsg]  = useState(null)
  const [overrideAll, setOverrideAll] = useState(false)

  // Re-categorize state
  const [recat,    setRecat]    = useState(false)
  const [recatMsg, setRecatMsg] = useState(null)

  async function load() {
    try {
      const [r, s] = await Promise.all([
        axios.get('/api/categories/rules'),
        axios.get('/api/categories/summary'),
      ])
      setRules(r.data)
      setSummary(s.data)
    } catch {
      // leave empty
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const ruleCategory = category || names[0] || ''

  async function addRule(e) {
    e.preventDefault()
    if (!keyword.trim() || !ruleCategory) return
    setAdding(true)
    setRuleMsg(null)
    try {
      const res = await axios.post('/api/categories/rules', {
        keyword: keyword.trim(), category: ruleCategory,
        applyMode: overrideAll ? 'all' : 'uncategorized',
      })
      const applied = res.data.applied || 0
      setRuleMsg(applied > 0
        ? `הכלל נוסף — ${applied} תנועות סווגו ל"${ruleCategory}"`
        : 'הכלל נוסף. הוא יחול על תנועות חדשות (לא נמצאו תנועות תואמות).')
      setKeyword('')
      await load()
    } finally {
      setAdding(false)
    }
  }

  async function deleteRule(id) {
    await axios.delete(`/api/categories/rules/${id}`)
    setRules(prev => prev.filter(r => r.id !== id))
  }

  async function recategorize(mode) {
    setRecat(true)
    setRecatMsg(null)
    try {
      const res = await axios.post('/api/categories/recategorize', { mode })
      setRecatMsg(`עודכנו ${res.data.updated} מתוך ${res.data.scanned} תנועות`)
      await load()
    } catch {
      setRecatMsg('הסיווג מחדש נכשל')
    } finally {
      setRecat(false)
    }
  }

  if (loading) return <div className="text-gray-400">טוען קטגוריות...</div>

  return (
    <div className="max-w-3xl">
      <h2 className="text-xl font-bold text-white mb-6">קטגוריות וכללים</h2>

      {/* Manage categories */}
      <CategoryManager onChanged={load} />

      {/* Re-categorize existing transactions */}
      <div className="bg-gray-900 rounded-xl p-5 mb-6">
        <div className="flex items-center gap-2 mb-2 text-white font-medium">
          <Wand2 className="w-4 h-4" /> החלת כללים על תנועות קיימות
        </div>
        <p className="text-sm text-gray-400 mb-3">
          הרץ את הכללים על תנועות שכבר יובאו. "רק לא מסווגות" בטוח — לעולם לא ידרוס
          קטגוריות שהגדרת ידנית.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => recategorize('other')}
            disabled={recat}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {recat ? 'מעבד...' : 'רק לא מסווגות'}
          </button>
          <button
            onClick={() => recategorize('all')}
            disabled={recat}
            className="bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {recat ? 'מעבד...' : 'הערך מחדש הכול'}
          </button>
          {recatMsg && <span className="text-sm text-green-400">{recatMsg}</span>}
        </div>
      </div>

      {/* Add a new rule */}
      <form onSubmit={addRule} className="bg-gray-900 rounded-xl p-5 mb-6">
        <div className="flex items-center gap-2 mb-3 text-white font-medium">
          <Plus className="w-4 h-4" /> הוספת כלל
        </div>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[12rem]">
            <label className="block text-sm text-gray-400 mb-1">
              אם התיאור מכיל…
            </label>
            <input
              type="text"
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              placeholder="לדוגמה: שופרסל או netflix"
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">קטגוריה</label>
            <select
              value={ruleCategory}
              onChange={e => setCategory(e.target.value)}
              className="bg-gray-700 text-white rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
            >
              {names.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <button
            type="submit"
            disabled={adding}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {adding ? 'מוסיף...' : 'הוסף'}
          </button>
        </div>
        <label className="flex items-center gap-2 mt-3 text-sm text-gray-400 cursor-pointer select-none w-fit">
          <input type="checkbox" checked={overrideAll} onChange={e => setOverrideAll(e.target.checked)} className="w-4 h-4 accent-blue-600" />
          החל גם על תנועות שכבר מסווגות (לא רק "אחר")
        </label>
        {ruleMsg && <p className="text-sm text-green-400 mt-3">{ruleMsg}</p>}
        <p className="text-xs text-gray-500 mt-2">
          כלל חדש מסווג מיד תנועות תואמות, וגם יחול על תנועות עתידיות.
        </p>
      </form>

      {/* Existing rules */}
      <div className="bg-gray-900 rounded-xl p-5 mb-6">
        <div className="flex items-center gap-2 mb-3 text-white font-medium">
          <Tag className="w-4 h-4" /> כללים <span className="text-gray-500 font-normal">({rules.length})</span>
        </div>
        {rules.length === 0 ? (
          <p className="text-gray-500 text-sm">אין עדיין כללים. הוסף אחד למעלה.</p>
        ) : (
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-sm">
              <tbody>
                {rules.map(r => (
                  <tr key={r.id} className="border-b border-gray-800/50">
                    <td className="py-2 text-gray-300 font-mono" dir="auto">{r.keyword}</td>
                    <td className="py-2 text-gray-400">← {r.category}</td>
                    <td className="py-2 text-left">
                      <button
                        onClick={() => deleteRule(r.id)}
                        className="text-gray-500 hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Summary by category */}
      <div className="bg-gray-900 rounded-xl p-5">
        <div className="text-white font-medium mb-3">הוצאות לפי קטגוריה</div>
        {summary.length === 0 ? (
          <p className="text-gray-500 text-sm">אין עדיין תנועות.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 border-b border-gray-800">
                <th className="text-right py-2 font-medium">קטגוריה</th>
                <th className="text-left py-2 font-medium">כמות</th>
                <th className="text-left py-2 font-medium">הוצאות</th>
              </tr>
            </thead>
            <tbody>
              {summary.map(s => (
                <tr key={s.category} className="border-b border-gray-800/50">
                  <td className="py-2 text-white">{s.category}</td>
                  <td className="py-2 text-left text-gray-400">{s.count}</td>
                  <td className="py-2 text-left font-mono text-red-400">
                    {s.expenses ? `-${ils(-s.expenses)}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
