import { useState, useEffect } from 'react'
import { Download } from 'lucide-react'
import axios from 'axios'
import { CATEGORIES } from '../categories.js'

export default function TransactionsPage() {
  const [rows,    setRows]    = useState([])
  const [total,   setTotal]   = useState(0)
  const [page,    setPage]    = useState(1)
  const [loading, setLoading] = useState(true)
  const [accounts, setAccounts] = useState([])
  const [filters, setFilters] = useState({ search: '', owner: '', source: '', category: '', account_id: '', only_in_totals: '', date_from: '', date_to: '' })

  // Load the account list once, for the account filter dropdown
  useEffect(() => {
    axios.get('/api/accounts').then(res => setAccounts(res.data)).catch(() => {})
  }, [])

  async function load(p = page) {
    setLoading(true)
    try {
      const params = { page: p, limit: 50, ...filters }
      // Remove empty filters
      Object.keys(params).forEach(k => { if (!params[k]) delete params[k] })
      const res = await axios.get('/api/transactions', { params })
      setRows(res.data.rows)
      setTotal(res.data.total)
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(1); setPage(1) }, [filters])
  useEffect(() => { load() }, [page])

  async function changeCategory(id, category) {
    await axios.put(`/api/transactions/${id}/category`, { category })
    setRows(prev => prev.map(r => r.id === id ? { ...r, category } : r))
  }

  function setFilter(key, value) {
    setFilters(prev => ({ ...prev, [key]: value }))
  }

  const totalPages = Math.ceil(total / 50)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-white">
          Transactions <span className="text-gray-500 text-base font-normal">({total})</span>
        </h2>
        <a
          href="/api/transactions/export/csv"
          className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Download className="w-4 h-4" />
          Export CSV
        </a>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="text"
          placeholder="Search description..."
          value={filters.search}
          onChange={e => setFilter('search', e.target.value)}
          className="bg-gray-900 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500 w-52"
        />
        <select
          value={filters.owner}
          onChange={e => setFilter('owner', e.target.value)}
          className="bg-gray-900 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All owners</option>
          <option value="Boris">Boris</option>
          <option value="Irena">Irena</option>
          <option value="Joint">Joint</option>
        </select>
        <select
          value={filters.category}
          onChange={e => setFilter('category', e.target.value)}
          className="bg-gray-900 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          value={filters.account_id}
          onChange={e => setFilter('account_id', e.target.value)}
          className="bg-gray-900 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All accounts</option>
          {accounts.map(a => (
            <option key={a.id} value={a.id}>
              {a.name}{a.include_in_totals ? '' : ' (excluded)'}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={filters.only_in_totals === '1'}
            onChange={e => setFilter('only_in_totals', e.target.checked ? '1' : '')}
            className="w-4 h-4 accent-blue-600"
          />
          Only accounts in totals
        </label>
        <input
          type="date"
          value={filters.date_from}
          onChange={e => setFilter('date_from', e.target.value)}
          className="bg-gray-900 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
        />
        <span className="text-gray-500 self-center text-sm">to</span>
        <input
          type="date"
          value={filters.date_to}
          onChange={e => setFilter('date_to', e.target.value)}
          className="bg-gray-900 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={() => setFilters({ search: '', owner: '', source: '', category: '', account_id: '', only_in_totals: '', date_from: '', date_to: '' })}
          className="text-gray-400 hover:text-white text-sm transition-colors"
        >
          Clear
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-gray-400 py-10 text-center">Loading...</div>
      ) : rows.length === 0 ? (
        <div className="text-gray-500 py-16 text-center">
          No transactions yet. They will appear here after syncing your accounts.
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl bg-gray-900">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 border-b border-gray-800">
                  <th className="text-left px-4 py-3 font-medium">Date</th>
                  <th className="text-left px-4 py-3 font-medium">Description</th>
                  <th className="text-right px-4 py-3 font-medium">Amount</th>
                  <th className="text-left px-4 py-3 font-medium">Category</th>
                  <th className="text-left px-4 py-3 font-medium">Owner</th>
                  <th className="text-left px-4 py-3 font-medium">Source</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                    <td className="px-4 py-3 text-gray-300 whitespace-nowrap">{r.date}</td>
                    <td className="px-4 py-3 text-white max-w-xs truncate">{r.description}</td>
                    <td className={`px-4 py-3 text-right whitespace-nowrap font-mono ${
                      r.amount < 0 ? 'text-red-400' : 'text-green-400'
                    }`}>
                      {r.amount < 0 ? '-' : '+'}₪{Math.abs(r.amount).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={r.category || 'אחר'}
                        onChange={e => changeCategory(r.id, e.target.value)}
                        className="bg-gray-800 text-gray-300 rounded px-2 py-1 text-xs outline-none"
                      >
                        {/* Keep an unmapped category visible instead of silently blank */}
                        {!CATEGORIES.includes(r.category) && r.category && (
                          <option value={r.category}>{r.category}</option>
                        )}
                        {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-gray-400">{r.owner}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{r.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 text-sm text-gray-400">
              <span>Page {page} of {totalPages}</span>
              <div className="flex gap-2">
                <button
                  disabled={page === 1}
                  onClick={() => setPage(p => p - 1)}
                  className="px-3 py-1 bg-gray-800 rounded disabled:opacity-30 hover:bg-gray-700 transition-colors"
                >Previous</button>
                <button
                  disabled={page === totalPages}
                  onClick={() => setPage(p => p + 1)}
                  className="px-3 py-1 bg-gray-800 rounded disabled:opacity-30 hover:bg-gray-700 transition-colors"
                >Next</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
