import { useState } from 'react'
import { Lock, Eye, EyeOff } from 'lucide-react'
import axios from 'axios'

export default function LockScreen({ onUnlocked }) {
  const [password, setPassword]   = useState('')
  const [showPw, setShowPw]       = useState(false)
  const [error, setError]         = useState('')
  const [loading, setLoading]     = useState(false)
  const [firstRun, setFirstRun]   = useState(false)
  const [confirm, setConfirm]     = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (firstRun && password !== confirm) {
      setError('הסיסמאות אינן תואמות')
      return
    }
    if (password.length < 8) {
      setError('הסיסמה חייבת להכיל לפחות 8 תווים')
      return
    }

    setLoading(true)
    try {
      const res = await axios.post('/api/auth/unlock', { password })
      if (res.data.status === 'first_run') {
        // This was our first unlock attempt and it set up the master password
        onUnlocked()
      } else {
        onUnlocked()
      }
    } catch (err) {
      if (err.response?.status === 401) {
        setError('סיסמה שגויה. נסה שוב.')
      } else if (err.response?.data?.error) {
        setError(err.response.data.error)
      } else {
        setError('שגיאת שרת. ודא שהאפליקציה פועלת.')
      }
    } finally {
      setLoading(false)
    }
  }

  // Detect first-run (no sentinel yet) by checking the error message
  // We show a "confirm password" field if the server says it's the first run
  function handleFirstRunToggle() {
    setFirstRun(true)
    setError('')
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo / title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl mb-4">
            <Lock className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">ניהול תקציב משפחתי</h1>
          <p className="text-gray-400 text-sm mt-1">לוח בקרה פיננסי פרטי</p>
        </div>

        {/* Login form */}
        <form onSubmit={handleSubmit} className="bg-gray-900 rounded-2xl p-6 shadow-xl">
          <h2 className="text-white font-semibold mb-4">
            {firstRun ? 'הגדרת סיסמה ראשית' : 'הזן סיסמה ראשית'}
          </h2>

          {firstRun && (
            <p className="text-yellow-400 text-sm mb-4 bg-yellow-400/10 rounded-lg p-3">
              הגדרה ראשונית — בחר סיסמה חזקה. לא ניתן לשחזר אותה אם תישכח.
            </p>
          )}

          {/* Password field */}
          <div className="relative mb-3">
            <input
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="סיסמה ראשית"
              className="w-full bg-gray-800 text-white rounded-lg px-4 py-3 pl-10 outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShowPw(v => !v)}
              className="absolute left-3 top-3.5 text-gray-400 hover:text-white"
            >
              {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          {/* Confirm field — only on first run */}
          {firstRun && (
            <div className="mb-3">
              <input
                type={showPw ? 'text' : 'password'}
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="אישור סיסמה"
                className="w-full bg-gray-800 text-white rounded-lg px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
              />
            </div>
          )}

          {/* Error message */}
          {error && (
            <p className="text-red-400 text-sm mb-3">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-3 rounded-lg transition-colors"
          >
            {loading ? 'בודק...' : (firstRun ? 'שמור סיסמה והיכנס' : 'כניסה')}
          </button>

          {!firstRun && (
            <button
              type="button"
              onClick={handleFirstRunToggle}
              className="w-full mt-3 text-gray-500 hover:text-gray-300 text-sm text-center transition-colors"
            >
              פעם ראשונה? הגדר סיסמה ראשית
            </button>
          )}
        </form>

        <p className="text-center text-gray-600 text-xs mt-4">
          כל הנתונים נשמרים במחשב שלך בלבד. שום דבר לא נשלח לענן.
        </p>
      </div>
    </div>
  )
}
