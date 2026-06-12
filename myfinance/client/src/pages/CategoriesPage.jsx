import { useState, useEffect } from 'react'
import { Plus, Trash2, Tag, Wand2 } from 'lucide-react'
import axios from 'axios'
import { CATEGORIES } from '../categories.js'

export default function CategoriesPage() {
  const [rules,   setRules]   = useState([])
  const [summary, setSummary] = useState([])
  const [loading, setLoading] = useState(true)

  // New-rule form state
  const [keyword,  setKeyword]  = useState('')
  const [category, setCategory] = useState('Groceries')
  const [adding,   setAdding]   = useState(false)

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

  async function addRule(e) {
    e.preventDefault()
    if (!keyword.trim()) return
    setAdding(true)
    try {
      await axios.post('/api/categories/rules', { keyword: keyword.trim(), category })
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
      setRecatMsg(`Updated ${res.data.updated} of ${res.data.scanned} transactions`)
      await load()
    } catch {
      setRecatMsg('Re-categorization failed')
    } finally {
      setRecat(false)
    }
  }

  if (loading) return <div className="text-gray-400">Loading categories...</div>

  return (
    <div className="max-w-3xl">
      <h2 className="text-xl font-bold text-white mb-6">Categories & Rules</h2>

      {/* Re-categorize existing transactions */}
      <div className="bg-gray-900 rounded-xl p-5 mb-6">
        <div className="flex items-center gap-2 mb-2 text-white font-medium">
          <Wand2 className="w-4 h-4" /> Apply rules to existing transactions
        </div>
        <p className="text-sm text-gray-400 mb-3">
          Run the rules on transactions you already imported. "Uncategorized only"
          is safe — it never overrides categories you set by hand.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => recategorize('other')}
            disabled={recat}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {recat ? 'Working...' : 'Uncategorized only'}
          </button>
          <button
            onClick={() => recategorize('all')}
            disabled={recat}
            className="bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {recat ? 'Working...' : 'Re-evaluate all'}
          </button>
          {recatMsg && <span className="text-sm text-green-400">{recatMsg}</span>}
        </div>
      </div>

      {/* Add a new rule */}
      <form onSubmit={addRule} className="bg-gray-900 rounded-xl p-5 mb-6">
        <div className="flex items-center gap-2 mb-3 text-white font-medium">
          <Plus className="w-4 h-4" /> Add a rule
        </div>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[12rem]">
            <label className="block text-sm text-gray-400 mb-1">
              If description contains…
            </label>
            <input
              type="text"
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              placeholder="e.g. שופרסל or netflix"
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Category</label>
            <select
              value={category}
              onChange={e => setCategory(e.target.value)}
              className="bg-gray-700 text-white rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
            >
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <button
            type="submit"
            disabled={adding}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {adding ? 'Adding...' : 'Add'}
          </button>
        </div>
      </form>

      {/* Existing rules */}
      <div className="bg-gray-900 rounded-xl p-5 mb-6">
        <div className="flex items-center gap-2 mb-3 text-white font-medium">
          <Tag className="w-4 h-4" /> Rules <span className="text-gray-500 font-normal">({rules.length})</span>
        </div>
        {rules.length === 0 ? (
          <p className="text-gray-500 text-sm">No rules yet. Add one above.</p>
        ) : (
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-sm">
              <tbody>
                {rules.map(r => (
                  <tr key={r.id} className="border-b border-gray-800/50">
                    <td className="py-2 text-gray-300 font-mono" dir="auto">{r.keyword}</td>
                    <td className="py-2 text-gray-400">→ {r.category}</td>
                    <td className="py-2 text-right">
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
        <div className="text-white font-medium mb-3">Spending by category</div>
        {summary.length === 0 ? (
          <p className="text-gray-500 text-sm">No transactions yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 border-b border-gray-800">
                <th className="text-left py-2 font-medium">Category</th>
                <th className="text-right py-2 font-medium">Count</th>
                <th className="text-right py-2 font-medium">Expenses</th>
              </tr>
            </thead>
            <tbody>
              {summary.map(s => (
                <tr key={s.category} className="border-b border-gray-800/50">
                  <td className="py-2 text-white">{s.category}</td>
                  <td className="py-2 text-right text-gray-400">{s.count}</td>
                  <td className="py-2 text-right font-mono text-red-400">
                    {s.expenses ? `-₪${Math.abs(s.expenses).toLocaleString()}` : '—'}
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
