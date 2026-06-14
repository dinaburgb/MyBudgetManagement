import { useState } from 'react'
import { LogOut, Building2, List, Tag, Wallet, BarChart2, ArrowLeftRight, Power, PiggyBank } from 'lucide-react'
import AccountsPage from './AccountsPage.jsx'
import AssetsPage from './AssetsPage.jsx'
import TransactionsPage from './TransactionsPage.jsx'
import CategoriesPage from './CategoriesPage.jsx'
import BudgetsPage from './BudgetsPage.jsx'
import OverviewPage from './OverviewPage.jsx'
import ComparePage from './ComparePage.jsx'
import { CategoriesProvider } from '../CategoriesContext.jsx'
import { DISCLAIMER_SHORT } from '../legal.js'
import axios from 'axios'

const TABS = [
  { id: 'overview',     label: 'סקירה',      icon: BarChart2 },
  { id: 'compare',      label: 'השוואה',     icon: ArrowLeftRight },
  { id: 'accounts',     label: 'חשבונות',    icon: Building2 },
  { id: 'transactions', label: 'תנועות',     icon: List },
  { id: 'categories',   label: 'קטגוריות',   icon: Tag },
  { id: 'budgets',      label: 'תקציבים',    icon: Wallet },
  { id: 'assets',       label: 'נכסים',      icon: PiggyBank },
]

export default function Dashboard({ onLock }) {
  const [activeTab, setActiveTab] = useState('overview')
  const [closed, setClosed] = useState(false)

  async function handleLock() {
    await axios.post('/api/auth/lock').catch(() => {})
    onLock()
  }

  async function handleClose() {
    if (!confirm('לסגור את התוכנה? השרת ייעצר ותצטרך להפעיל אותו מחדש כדי להיכנס.')) return
    setClosed(true)
    await axios.post('/api/app/shutdown').catch(() => {})  // server exits; request may not resolve
  }

  // After shutdown the server is gone — show a friendly end screen.
  if (closed) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4 text-center">
        <div>
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-800 rounded-2xl mb-4">
            <Power className="w-8 h-8 text-gray-400" />
          </div>
          <h1 className="text-xl font-bold text-white mb-2">התוכנה נסגרה</h1>
          <p className="text-gray-400 text-sm">אפשר לסגור את הלשונית. כדי להיכנס שוב — הפעל מחדש את השרת.</p>
        </div>
      </div>
    )
  }

  return (
    <CategoriesProvider>
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Top navigation bar */}
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <h1 className="text-lg font-bold text-white">ניהול תקציב משפחתי</h1>
          <nav className="flex gap-1">
            {TABS.map(tab => {
              const Icon = tab.icon
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    activeTab === tab.id
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-400 hover:text-white hover:bg-gray-800'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </button>
              )
            })}
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={handleLock}
            className="flex items-center gap-2 text-gray-400 hover:text-white text-sm transition-colors"
          >
            <LogOut className="w-4 h-4" />
            נעילה
          </button>
          <button
            onClick={handleClose}
            className="flex items-center gap-2 text-gray-400 hover:text-red-400 text-sm transition-colors"
          >
            <Power className="w-4 h-4" />
            סגירת התוכנה
          </button>
        </div>
      </header>

      {/* Page content */}
      <main className="p-6">
        {activeTab === 'overview'     && <OverviewPage />}
        {activeTab === 'compare'      && <ComparePage />}
        {activeTab === 'accounts'     && <AccountsPage />}
        {activeTab === 'transactions' && <TransactionsPage />}
        {activeTab === 'categories'   && <CategoriesPage />}
        {activeTab === 'budgets'      && <BudgetsPage />}
        {activeTab === 'assets'       && <AssetsPage />}
      </main>

      {/* Short disclaimer at the bottom of every tab */}
      <footer className="px-6 py-4 text-center text-gray-600 text-xs border-t border-gray-800/60">
        {DISCLAIMER_SHORT}
      </footer>
    </div>
    </CategoriesProvider>
  )
}
