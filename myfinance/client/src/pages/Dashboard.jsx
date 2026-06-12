import { useState } from 'react'
import { LogOut, Building2, List, BarChart2 } from 'lucide-react'
import AccountsPage from './AccountsPage.jsx'
import TransactionsPage from './TransactionsPage.jsx'
import axios from 'axios'

const TABS = [
  { id: 'accounts',     label: 'Accounts',     icon: Building2 },
  { id: 'transactions', label: 'Transactions',  icon: List },
  { id: 'dashboard',    label: 'Dashboard',     icon: BarChart2 },
]

export default function Dashboard({ onLock }) {
  const [activeTab, setActiveTab] = useState('accounts')

  async function handleLock() {
    await axios.post('/api/auth/lock').catch(() => {})
    onLock()
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Top navigation bar */}
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <h1 className="text-lg font-bold text-white">MyFinance</h1>
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
        <button
          onClick={handleLock}
          className="flex items-center gap-2 text-gray-400 hover:text-white text-sm transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Lock
        </button>
      </header>

      {/* Page content */}
      <main className="p-6">
        {activeTab === 'accounts'     && <AccountsPage />}
        {activeTab === 'transactions' && <TransactionsPage />}
        {activeTab === 'dashboard'    && (
          <div className="text-gray-400 text-center py-20">
            Dashboard charts coming in Phase 6
          </div>
        )}
      </main>
    </div>
  )
}
