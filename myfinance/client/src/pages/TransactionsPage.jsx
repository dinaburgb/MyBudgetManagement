import { useState, useEffect, Fragment } from 'react'
import { Download, Plus } from 'lucide-react'
import axios from 'axios'
import { useCategories } from '../CategoriesContext.jsx'
import NoteEditor from '../NoteEditor.jsx'
import ApplyRulePrompt from '../ApplyRulePrompt.jsx'
import MultiSelect from '../MultiSelect.jsx'
import ManualTxnForm from '../ManualTxnForm.jsx'
import TransfersReview from '../TransfersReview.jsx'

const SOURCE_LABELS = {
  hapoalim: 'הפועלים', discount: 'דיסקונט', fibi: 'הבינלאומי', mizrahi: 'מזרחי',
  onezero: 'וואן זירו', isracard: 'ישראכרט', cal: 'ויזה כאל', max: 'מקס',
}

export default function TransactionsPage() {
  const { names: CATEGORIES } = useCategories()
  const [rows,    setRows]    = useState([])
  const [total,   setTotal]   = useState(0)
  const [page,    setPage]    = useState(1)
  const [loading, setLoading] = useState(true)
  const [accounts, setAccounts] = useState([])
  const [subAccounts, setSubAccounts] = useState([])
  const [showAdd, setShowAdd] = useState(false)
  const EMPTY_FILTERS = { search: '', owners: [], categories: [], account_ids: [], subaccounts: [], only_in_totals: '', foreign_currency: '', date_from: '', date_to: '' }
  const [filters, setFilters] = useState(EMPTY_FILTERS)

  // Bulk selection: ids the user ticked, or "all filtered" mode (beyond this page)
  const [selected, setSelected] = useState(new Set())
  const [allFiltered, setAllFiltered] = useState(false)
  const [bulkCat, setBulkCat] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkDone, setBulkDone] = useState(null)   // success message after apply

  // Load the account + sub-account lists once, for the filter dropdowns
  useEffect(() => {
    axios.get('/api/accounts').then(res => setAccounts(res.data)).catch(() => {})
    axios.get('/api/accounts/subaccounts').then(res => setSubAccounts(res.data)).catch(() => {})
  }, [])

  // All distinct owners, taken from the accounts (so every owner shows up, not a
  // hardcoded list).
  const owners = [...new Set(accounts.map(a => a.owner).filter(Boolean))]

  // The active filters as API query params (shared by load() and bulk apply, so
  // "apply to all filtered" matches exactly what's on screen).
  function filterParams() {
    const params = {}
    if (filters.search)            params.search = filters.search
    if (filters.owners.length)     params.owner = filters.owners.join(',')
    if (filters.categories.length) params.category = filters.categories.join(',')
    if (filters.account_ids.length) params.account_id = filters.account_ids.join(',')
    if (filters.subaccounts.length) params.subaccount = filters.subaccounts.join(',')
    if (filters.only_in_totals)    params.only_in_totals = filters.only_in_totals
    if (filters.foreign_currency)  params.foreign_currency = filters.foreign_currency
    if (filters.date_from)         params.date_from = filters.date_from
    if (filters.date_to)           params.date_to = filters.date_to
    return params
  }

  async function load(p = page) {
    setLoading(true)
    try {
      const params = { page: p, limit: 50, ...filterParams() }
      const res = await axios.get('/api/transactions', { params })
      setRows(res.data.rows)
      setTotal(res.data.total)
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  // Changing a filter resets the page AND the selection (a stale selection could
  // otherwise bulk-update rows the user no longer sees).
  useEffect(() => { load(1); setPage(1); clearSelection() }, [filters])
  useEffect(() => { load() }, [page])

  function clearSelection() {
    setSelected(new Set())
    setAllFiltered(false)
    setBulkDone(null)
  }

  function toggleRow(id) {
    setAllFiltered(false)
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  // Header checkbox: select/deselect every row on the current page.
  const pageAllSelected = rows.length > 0 && rows.every(r => selected.has(r.id))
  function togglePage() {
    setAllFiltered(false)
    setSelected(prev => {
      const next = new Set(prev)
      if (pageAllSelected) rows.forEach(r => next.delete(r.id))
      else rows.forEach(r => next.add(r.id))
      return next
    })
  }

  const hasActiveFilters = Object.keys(filterParams()).length > 0
  const selectedCount = allFiltered ? total : selected.size

  async function applyBulkCategory() {
    if (!bulkCat || selectedCount === 0) return
    setBulkBusy(true)
    try {
      const body = allFiltered
        ? { filters: filterParams(), category: bulkCat }
        : { ids: [...selected], category: bulkCat }
      const res = await axios.put('/api/transactions/bulk/category', body)
      setSelected(new Set())
      setAllFiltered(false)
      setBulkDone(`${res.data.updated} תנועות הועברו לקטגוריה "${bulkCat}"`)
      await load()
    } finally {
      setBulkBusy(false)
    }
  }

  // After a category change, offer to apply it to all similar transactions.
  const [rulePrompt, setRulePrompt] = useState(null)   // { id, description, category }

  async function changeCategory(id, category) {
    const row = rows.find(r => r.id === id)
    await axios.put(`/api/transactions/${id}/category`, { category })
    setRows(prev => prev.map(r => r.id === id ? { ...r, category } : r))
    setRulePrompt({ id, description: row?.description, category })
  }

  function updateNote(id, note) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, note } : r))
  }

  async function unmarkTransfer(id) {
    await axios.post('/api/transfers/unmark', { id })
    setRows(prev => prev.map(r => r.id === id ? { ...r, is_transfer: 0 } : r))
  }

  function setFilter(key, value) {
    setFilters(prev => ({ ...prev, [key]: value }))
  }

  const totalPages = Math.ceil(total / 50)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-white">
          תנועות <span className="text-gray-500 text-base font-normal">({total})</span>
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAdd(v => !v)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            הוספה ידנית
          </button>
          <a
            href="/api/transactions/export/csv"
            className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Download className="w-4 h-4" />
            ייצוא CSV
          </a>
        </div>
      </div>

      {showAdd && (
        <ManualTxnForm
          accounts={accounts}
          categories={CATEGORIES}
          owners={owners}
          onAdded={() => { setShowAdd(false); load(1); setPage(1) }}
          onClose={() => setShowAdd(false)}
        />
      )}

      {/* Suggested internal-transfer pairs to review */}
      <TransfersReview onChange={() => load(1)} />

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="text"
          placeholder="חיפוש לפי תחילת התיאור..."
          value={filters.search}
          onChange={e => setFilter('search', e.target.value)}
          className="bg-gray-900 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500 w-52"
        />
        <MultiSelect
          label="בעלים"
          options={owners.map(o => ({ value: o, label: o }))}
          selected={filters.owners}
          onChange={v => setFilter('owners', v)}
        />
        <MultiSelect
          label="קטגוריות"
          options={CATEGORIES.map(c => ({ value: c, label: c }))}
          selected={filters.categories}
          onChange={v => setFilter('categories', v)}
        />
        <MultiSelect
          label="חשבונות"
          options={accounts.map(a => ({ value: String(a.id), label: `${a.name}${a.include_in_totals ? '' : ' (לא נכלל)'}` }))}
          selected={filters.account_ids}
          onChange={v => setFilter('account_ids', v)}
        />
        {subAccounts.length > 0 && (
          <MultiSelect
            label="כרטיס / תת-חשבון"
            options={subAccounts
              // When specific accounts are chosen, narrow the sub-account list to them.
              .filter(s => filters.account_ids.length === 0 || filters.account_ids.includes(String(s.account_id)))
              .map(s => ({
                value: `${s.account_id}:${s.account_number}`,
                label: `${s.account_name} · ${s.label ? `${s.label} (${s.account_number})` : s.account_number}`,
              }))}
            selected={filters.subaccounts}
            onChange={v => setFilter('subaccounts', v)}
          />
        )}
        <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={filters.only_in_totals === '1'}
            onChange={e => setFilter('only_in_totals', e.target.checked ? '1' : '')}
            className="w-4 h-4 accent-blue-600"
          />
          רק חשבונות הנכללים בחישוב
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={filters.foreign_currency === '1'}
            onChange={e => setFilter('foreign_currency', e.target.checked ? '1' : '')}
            className="w-4 h-4 accent-blue-600"
          />
          רק מטבע חוץ
        </label>
        <input
          type="date"
          value={filters.date_from}
          onChange={e => setFilter('date_from', e.target.value)}
          className="bg-gray-900 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
        />
        <span className="text-gray-500 self-center text-sm">עד</span>
        <input
          type="date"
          value={filters.date_to}
          onChange={e => setFilter('date_to', e.target.value)}
          className="bg-gray-900 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={() => setFilters(EMPTY_FILTERS)}
          className="text-gray-400 hover:text-white text-sm transition-colors"
        >
          נקה
        </button>
      </div>

      {/* Bulk action bar — appears when at least one row is ticked */}
      {(selectedCount > 0 || bulkDone) && (
        <div className="flex flex-wrap items-center gap-3 mb-4 bg-gray-800 border border-gray-700 rounded-xl px-4 py-3">
          {selectedCount > 0 ? (
            <>
              <span className="text-sm text-white font-medium">
                נבחרו {selectedCount} תנועות{allFiltered ? ' (כל התוצאות המסוננות)' : ''}
              </span>
              {/* Extend the page selection to every filtered row (server-side) */}
              {!allFiltered && pageAllSelected && total > rows.length && hasActiveFilters && (
                <button
                  onClick={() => setAllFiltered(true)}
                  className="text-blue-400 hover:text-blue-300 text-sm underline"
                >
                  בחר את כל {total} התנועות המסוננות
                </button>
              )}
              <select
                value={bulkCat}
                onChange={e => setBulkCat(e.target.value)}
                className="bg-gray-900 text-white rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">העבר לקטגוריה…</option>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <button
                onClick={applyBulkCategory}
                disabled={!bulkCat || bulkBusy}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white px-4 py-1.5 rounded-lg text-sm font-medium transition-colors"
              >
                {bulkBusy ? 'מעדכן…' : 'החל'}
              </button>
              <button
                onClick={clearSelection}
                className="text-gray-400 hover:text-white text-sm"
              >
                נקה בחירה
              </button>
            </>
          ) : (
            <>
              <span className="text-sm text-emerald-400">{bulkDone}</span>
              <button onClick={() => setBulkDone(null)} className="text-gray-400 hover:text-white text-sm">סגור</button>
            </>
          )}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="text-gray-400 py-10 text-center">טוען...</div>
      ) : rows.length === 0 ? (
        <div className="text-gray-500 py-16 text-center">
          אין עדיין תנועות. הן יופיעו כאן לאחר סנכרון החשבונות.
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl bg-gray-900">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 border-b border-gray-800">
                  <th className="px-3 py-3 w-8">
                    <input
                      type="checkbox"
                      checked={pageAllSelected}
                      onChange={togglePage}
                      className="w-4 h-4 accent-blue-600 cursor-pointer"
                      title="בחר את כל העמוד"
                    />
                  </th>
                  <th className="text-right px-4 py-3 font-medium">תאריך</th>
                  <th className="text-right px-4 py-3 font-medium">תיאור</th>
                  <th className="text-left px-4 py-3 font-medium">סכום</th>
                  <th className="text-right px-4 py-3 font-medium">קטגוריה</th>
                  <th className="text-right px-4 py-3 font-medium">הערה</th>
                  <th className="text-right px-4 py-3 font-medium">בעלים</th>
                  <th className="text-right px-4 py-3 font-medium">מקור</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <Fragment key={r.id}>
                  <tr className={`border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors ${
                    (allFiltered || selected.has(r.id)) ? 'bg-blue-500/5' : ''
                  }`}>
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={allFiltered || selected.has(r.id)}
                        onChange={() => toggleRow(r.id)}
                        className="w-4 h-4 accent-blue-600 cursor-pointer"
                      />
                    </td>
                    <td className="px-4 py-3 text-gray-300 whitespace-nowrap">{r.date}</td>
                    <td className="px-4 py-3 text-white max-w-xs">
                      <div className="truncate">{r.description}</div>
                      {r.type === 'installment' && r.installment_total > 1 && (
                        <span className="inline-block mt-0.5 text-xs text-amber-400 bg-amber-500/10 rounded px-1.5 py-0.5">
                          תשלום {r.installment_number} מתוך {r.installment_total}
                        </span>
                      )}
                      {r.is_transfer === 1 && (
                        <span className="inline-flex items-center gap-1 mt-0.5 text-xs text-blue-300 bg-blue-500/10 rounded px-1.5 py-0.5">
                          העברה פנימית
                          <button onClick={() => unmarkTransfer(r.id)} className="text-gray-400 hover:text-white" title="בטל סימון">✕</button>
                        </span>
                      )}
                    </td>
                    <td className={`px-4 py-3 text-left whitespace-nowrap font-mono ${
                      r.amount < 0 ? 'text-red-400' : 'text-green-400'
                    }`}>
                      {r.amount < 0 ? '-' : '+'}₪{Math.abs(r.amount).toLocaleString('he-IL')}
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
                    <td className="px-4 py-3 max-w-[12rem]">
                      <NoteEditor id={r.id} note={r.note} onSaved={n => updateNote(r.id, n)} />
                    </td>
                    <td className="px-4 py-3 text-gray-400">{r.owner}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      <div>{r.account_name || SOURCE_LABELS[r.source] || r.source}</div>
                      {r.account_number && (
                        <div className="text-gray-600">
                          {r.account_label ? `${r.account_label} · ${r.account_number}` : r.account_number}
                        </div>
                      )}
                    </td>
                  </tr>
                  {rulePrompt?.id === r.id && (
                    <tr>
                      <td colSpan={8} className="px-4 pb-3">
                        <ApplyRulePrompt
                          description={rulePrompt.description}
                          category={rulePrompt.category}
                          onApplied={() => { setRulePrompt(null); load() }}
                          onClose={() => setRulePrompt(null)}
                        />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 text-sm text-gray-400">
              <span>עמוד {page} מתוך {totalPages}</span>
              <div className="flex gap-2">
                <button
                  disabled={page === 1}
                  onClick={() => setPage(p => p - 1)}
                  className="px-3 py-1 bg-gray-800 rounded disabled:opacity-30 hover:bg-gray-700 transition-colors"
                >הקודם</button>
                <button
                  disabled={page === totalPages}
                  onClick={() => setPage(p => p + 1)}
                  className="px-3 py-1 bg-gray-800 rounded disabled:opacity-30 hover:bg-gray-700 transition-colors"
                >הבא</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
