import { useState, useEffect } from 'react'
import { Lock, Eye, EyeOff, KeyRound, RotateCcw, ArrowRight } from 'lucide-react'
import axios from 'axios'
import { DISCLAIMER_FULL, DISCLAIMER_TITLE } from '../legal.js'

const ACCEPT_KEY = 'mbm_disclaimer_accepted'

export default function LockScreen({ onUnlocked }) {
  const [mode, setMode] = useState('unlock')          // 'unlock' | 'change' | 'reset'
  const [passwordSet, setPasswordSet] = useState(true) // until status loads
  const [accepted, setAccepted] = useState(() => localStorage.getItem(ACCEPT_KEY) === '1')

  const [password, setPassword] = useState('')
  const [confirm,  setConfirm]  = useState('')
  const [showPw,   setShowPw]   = useState(false)

  const [oldPw, setOldPw]   = useState('')
  const [newPw, setNewPw]   = useState('')
  const [newPw2, setNewPw2] = useState('')
  const [resetConfirm, setResetConfirm] = useState(false)

  const [error,   setError]   = useState('')
  const [msg,     setMsg]     = useState('')
  const [loading, setLoading] = useState(false)

  // Know whether this is a first run (no password set yet).
  useEffect(() => {
    axios.get('/api/auth/status').then(r => setPasswordSet(!!r.data.passwordSet)).catch(() => {})
  }, [])

  const firstRun = !passwordSet

  function acceptToggle(v) {
    setAccepted(v)
    localStorage.setItem(ACCEPT_KEY, v ? '1' : '0')
  }

  async function doUnlock(e) {
    e.preventDefault(); setError('')
    if (!accepted) { setError('יש לאשר את תנאי השימוש'); return }
    if (firstRun && password !== confirm) { setError('הסיסמאות אינן תואמות'); return }
    if (password.length < 8) { setError('הסיסמה חייבת להכיל לפחות 8 תווים'); return }
    setLoading(true)
    try {
      await axios.post('/api/auth/unlock', { password })
      onUnlocked()
    } catch (err) {
      setError(err.response?.status === 401 ? 'סיסמה שגויה. נסה שוב.'
        : err.response?.data?.error || 'שגיאת שרת. ודא שהאפליקציה פועלת.')
    } finally { setLoading(false) }
  }

  async function doChange(e) {
    e.preventDefault(); setError(''); setMsg('')
    if (!accepted) { setError('יש לאשר את תנאי השימוש'); return }
    if (newPw !== newPw2) { setError('הסיסמאות החדשות אינן תואמות'); return }
    if (newPw.length < 8) { setError('הסיסמה החדשה חייבת להכיל לפחות 8 תווים'); return }
    setLoading(true)
    try {
      await axios.post('/api/auth/change-password', { oldPassword: oldPw, newPassword: newPw })
      onUnlocked()   // server session is now unlocked with the new key
    } catch (err) {
      setError(err.response?.data?.error === 'Wrong current password'
        ? 'הסיסמה הנוכחית שגויה' : err.response?.data?.error || 'שגיאה בהחלפת הסיסמה')
    } finally { setLoading(false) }
  }

  async function doReset(e) {
    e.preventDefault(); setError(''); setMsg('')
    if (!resetConfirm) { setError('יש לאשר שהבנת שפרטי הבנקים יימחקו'); return }
    setLoading(true)
    try {
      const r = await axios.post('/api/auth/reset', { confirm: 'RESET' })
      setPasswordSet(false); setMode('unlock')
      setOldPw(''); setNewPw(''); setNewPw2(''); setPassword(''); setConfirm(''); setResetConfirm(false)
      setMsg(`הסיסמה אופסה. ${r.data.clearedAccounts} חשבונות נוקו — תצטרך להזין מחדש את פרטי ההתחברות לבנקים. כעת הגדר סיסמה ראשית חדשה. כל התנועות והנתונים נשמרו.`)
    } catch (err) {
      setError(err.response?.data?.error || 'שגיאה באיפוס')
    } finally { setLoading(false) }
  }

  const pwInput = (value, onChange, placeholder, autoFocus = false) => (
    <div className="relative mb-3">
      <input
        type={showPw ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="w-full bg-gray-800 text-white rounded-lg px-4 py-3 pl-10 outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
      />
      <button type="button" onClick={() => setShowPw(v => !v)} className="absolute left-3 top-3.5 text-gray-400 hover:text-white">
        {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl mb-4">
            <Lock className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">ניהול תקציב משפחתי</h1>
          <p className="text-gray-400 text-sm mt-1">לוח בקרה פיננסי פרטי</p>
        </div>

        <div className="bg-gray-900 rounded-2xl p-6 shadow-xl">
          {/* ---- UNLOCK / FIRST RUN ---- */}
          {mode === 'unlock' && (
            <form onSubmit={doUnlock}>
              <h2 className="text-white font-semibold mb-4">{firstRun ? 'הגדרת סיסמה ראשית' : 'הזן סיסמה ראשית'}</h2>
              {firstRun && (
                <p className="text-yellow-400 text-sm mb-4 bg-yellow-400/10 rounded-lg p-3">
                  הגדרה ראשונית — בחר סיסמה חזקה. לא ניתן לשחזר אותה אם תישכח (אך תוכל לאפס ולהתחיל מחדש).
                </p>
              )}
              {pwInput(password, setPassword, 'סיסמה ראשית', true)}
              {firstRun && pwInput(confirm, setConfirm, 'אישור סיסמה')}

              {/* Disclaimer with required acceptance checkbox */}
              <div className="mt-4 mb-3 bg-gray-800/60 border border-gray-700 rounded-lg p-3">
                <div className="text-white text-sm font-semibold mb-2">{DISCLAIMER_TITLE}</div>
                <div className="text-gray-300 text-xs leading-relaxed max-h-40 overflow-y-auto whitespace-pre-line">{DISCLAIMER_FULL}</div>
                <label className="flex items-start gap-2 mt-3 text-sm text-gray-200 cursor-pointer select-none">
                  <input type="checkbox" checked={accepted} onChange={e => acceptToggle(e.target.checked)} className="w-4 h-4 mt-0.5 accent-blue-600" />
                  קראתי ואני מאשר/ת שהשימוש בתוכנה הוא על אחריותי בלבד וללא כל אחריות מצד המפתח.
                </label>
              </div>

              {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
              {msg && <p className="text-green-400 text-sm mb-3">{msg}</p>}

              <button type="submit" disabled={loading || !accepted}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-3 rounded-lg transition-colors">
                {loading ? 'בודק...' : (firstRun ? 'שמור סיסמה והיכנס' : 'כניסה')}
              </button>

              {!firstRun && (
                <div className="flex items-center justify-between mt-4 text-sm">
                  <button type="button" onClick={() => { setMode('change'); setError(''); setMsg('') }}
                    className="flex items-center gap-1.5 text-gray-400 hover:text-white transition-colors">
                    <KeyRound className="w-4 h-4" /> החלפת סיסמה
                  </button>
                  <button type="button" onClick={() => { setMode('reset'); setError(''); setMsg('') }}
                    className="flex items-center gap-1.5 text-gray-400 hover:text-amber-400 transition-colors">
                    <RotateCcw className="w-4 h-4" /> שכחתי סיסמה
                  </button>
                </div>
              )}
            </form>
          )}

          {/* ---- CHANGE PASSWORD ---- */}
          {mode === 'change' && (
            <form onSubmit={doChange}>
              <button type="button" onClick={() => { setMode('unlock'); setError(''); setMsg('') }}
                className="flex items-center gap-1 text-gray-400 hover:text-white text-sm mb-3"><ArrowRight className="w-4 h-4" /> חזרה</button>
              <h2 className="text-white font-semibold mb-4">החלפת סיסמה ראשית</h2>
              {pwInput(oldPw, setOldPw, 'סיסמה נוכחית', true)}
              {pwInput(newPw, setNewPw, 'סיסמה חדשה')}
              {pwInput(newPw2, setNewPw2, 'אישור סיסמה חדשה')}
              <p className="text-gray-500 text-xs mb-3">פרטי ההתחברות לבנקים יוצפנו מחדש אוטומטית במפתח החדש.</p>
              {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
              <button type="submit" disabled={loading || !accepted}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-3 rounded-lg transition-colors">
                {loading ? 'מחליף...' : 'החלף סיסמה והיכנס'}
              </button>
              {!accepted && <p className="text-amber-500/80 text-xs mt-2">יש לאשר את תנאי השימוש (במסך הכניסה) כדי להמשיך.</p>}
            </form>
          )}

          {/* ---- RESET / FORGOT ---- */}
          {mode === 'reset' && (
            <form onSubmit={doReset}>
              <button type="button" onClick={() => { setMode('unlock'); setError(''); setMsg('') }}
                className="flex items-center gap-1 text-gray-400 hover:text-white text-sm mb-3"><ArrowRight className="w-4 h-4" /> חזרה</button>
              <h2 className="text-white font-semibold mb-3">איפוס סיסמה ראשית</h2>
              <div className="text-sm text-gray-300 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 mb-3 leading-relaxed">
                לא ניתן לשחזר סיסמה שנשכחה — ההצפנה מתבססת עליה. איפוס יאפשר להגדיר סיסמה חדשה,
                אך <span className="text-amber-300 font-medium">פרטי ההתחברות לבנקים יימחקו</span> ותצטרך להזינם מחדש.
                <span className="text-green-400"> כל התנועות, הקטגוריות והתקציבים יישמרו.</span>
              </div>
              <label className="flex items-start gap-2 mb-3 text-sm text-gray-200 cursor-pointer select-none">
                <input type="checkbox" checked={resetConfirm} onChange={e => setResetConfirm(e.target.checked)} className="w-4 h-4 mt-0.5 accent-amber-600" />
                אני מבין/ה שפרטי הבנקים יימחקו ויהיה צורך להזינם מחדש.
              </label>
              {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
              <button type="submit" disabled={loading || !resetConfirm}
                className="w-full bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-semibold py-3 rounded-lg transition-colors">
                {loading ? 'מאפס...' : 'אפס סיסמה'}
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-gray-600 text-xs mt-4">
          כל הנתונים נשמרים במחשב שלך בלבד. שום דבר לא נשלח לענן.
        </p>
      </div>
    </div>
  )
}
