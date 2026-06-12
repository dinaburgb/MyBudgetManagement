import { useState, useEffect } from 'react'
import LockScreen from './pages/LockScreen.jsx'
import Dashboard from './pages/Dashboard.jsx'
import axios from 'axios'

export default function App() {
  const [unlocked, setUnlocked] = useState(false)
  const [checking, setChecking] = useState(true)

  // On load, check if the session is already unlocked
  useEffect(() => {
    axios.get('/api/auth/status')
      .then(r => setUnlocked(r.data.unlocked))
      .catch(() => {})
      .finally(() => setChecking(false))
  }, [])

  if (checking) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-400">Loading...</div>
      </div>
    )
  }

  if (!unlocked) {
    return <LockScreen onUnlocked={() => setUnlocked(true)} />
  }

  return <Dashboard onLock={() => setUnlocked(false)} />
}
