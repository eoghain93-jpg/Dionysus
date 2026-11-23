import { useState, useEffect, useCallback, useRef } from 'react'
import { Delete, X, Lock, Clock, Users, WifiOff } from 'lucide-react'
import { verifyStaffPin } from '../lib/audit/staff'
import { logEvent } from '../lib/audit/log'
import { useSessionStore } from '../stores/sessionStore'
import { useLockoutCountdown } from '../hooks/useLockoutCountdown'
import PinLoginScreen from './till/PinLoginScreen'

const PIN_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'clear']
const KEY_EVENTS = ['keydown', 'keypress', 'keyup']

// A request on a bad connection can hang for minutes without failing. The
// lock screen must not sit on "Verifying…" that long: after this, the check
// counts as "could not reach the server".
const UNLOCK_CHECK_TIMEOUT_MS = 8000

function withTimeout(promise, ms) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('PIN check timed out')), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/**
 * LockScreen — shown by StaffGate while the till is locked (idle timeout or
 * the Lock button). The page underneath stays mounted but hidden and inert,
 * so the open order and anything half-entered are exactly as they were left.
 *
 * Two ways back in:
 *   - the signed-in person enters their PIN (checked by the database,
 *     recorded with purpose 'unlock') and carries on;
 *   - "Someone else" — the normal staff sign-in. The open order stays, as
 *     it does on Switch User.
 *
 * Never strands a working till: if the PIN check cannot reach the server at
 * all (it REJECTS or never answers, as opposed to answering "wrong PIN"),
 * the same person may carry on without it. That is recorded as needing a
 * look.
 */
export default function LockScreen() {
  const activeStaff = useSessionStore(s => s.activeStaff)
  const unlock = useSessionStore(s => s.unlock)

  const [mode, setMode] = useState('pin') // 'pin' | 'someone_else'
  const [digits, setDigits] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState(null)
  // True only after a PIN check could not reach the server.
  const [unreachable, setUnreachable] = useState(false)
  const { isLocked, remainingLabel, lock } = useLockoutCountdown()
  const rootRef = useRef(null)

  // The pages underneath are still mounted, and some listen for keys on the
  // window or document (the card-scanner wedge on the Till page, Escape to
  // close a modal). Nothing typed or scanned at a locked till may reach
  // them. Only propagation is stopped: Tab, Enter and the staff picker keep
  // working because those are browser defaults, not listeners.
  useEffect(() => {
    const swallow = e => e.stopPropagation()
    for (const type of KEY_EVENTS) window.addEventListener(type, swallow, true)
    return () => {
      for (const type of KEY_EVENTS) window.removeEventListener(type, swallow, true)
    }
  }, [])

  // Take focus off whatever was focused in the page underneath.
  useEffect(() => {
    rootRef.current?.focus?.()
  }, [])

  // False once this lock screen has gone (unlocked some other way): a PIN
  // check still in flight must not then unlock a till locked again since.
  const shownRef = useRef(true)
  useEffect(() => {
    shownRef.current = true
    return () => { shownRef.current = false }
  }, [])

  const handleVerify = useCallback(async (memberId, pin) => {
    setVerifying(true)
    setError(null)
    try {
      const data = await withTimeout(verifyStaffPin(memberId, pin, 'unlock'), UNLOCK_CHECK_TIMEOUT_MS)
      if (!shownRef.current) return
      // The server answered, so the PIN decides — no carrying on without it.
      setUnreachable(false)
      if (data?.valid) {
        logEvent('till.unlocked', {}, { severity: 0 })
        unlock()
      } else if (data?.reason === 'locked') {
        setDigits('')
        lock(data.retryAfterSeconds)
      } else if (data?.reason === 'no_pin') {
        setError('No PIN is set for this person. Choose "Someone else" to sign in.')
        setDigits('')
      } else {
        setError('Incorrect PIN. Please try again.')
        setDigits('')
      }
    } catch {
      // Neither the database nor the fallback could be reached (or neither
      // answered in time).
      setUnreachable(true)
      setDigits('')
    } finally {
      setVerifying(false)
    }
  }, [unlock, lock])

  // Auto-submit when 4 digits entered
  useEffect(() => {
    if (mode === 'pin' && digits.length === 4 && activeStaff) {
      handleVerify(activeStaff.id, digits)
    }
  }, [mode, digits, activeStaff, handleVerify])

  function handleKey(key) {
    if (verifying || isLocked) return
    setError(null)
    if (key === 'back') {
      setDigits(d => d.slice(0, -1))
    } else if (key === 'clear') {
      setDigits('')
    } else {
      setDigits(d => d.length < 4 ? d + key : d)
    }
  }

  function carryOnUnverified() {
    logEvent('till.unlocked_unverified', {}, { severity: 2 })
    unlock()
  }

  if (!activeStaff) return null

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="Till locked"
      className="fixed inset-0 z-[200] bg-slate-900 flex items-center justify-center p-4 overflow-y-auto focus:outline-none"
    >
      {mode === 'someone_else' ? (
        // A full sign-in: opens the new person's session (ending the previous
        // one on the server) and, through setActiveStaff, unlocks the till.
        <PinLoginScreen
          onBack={() => setMode('pin')}
          onSignedIn={() => logEvent('till.unlocked', { via: 'sign_in' }, { severity: 0 })}
        />
      ) : (
        <div className="w-full max-w-sm space-y-5">
          <div className="text-center space-y-2">
            <div className="flex items-center justify-center">
              <Lock size={32} className="text-slate-400" aria-hidden="true" />
            </div>
            <h1 className="text-white text-2xl font-bold">Till Locked</h1>
            <p className="text-slate-400 text-sm">
              Enter PIN for <span className="text-white font-semibold">{activeStaff.name}</span> to carry on
            </p>
          </div>

          <div aria-label="PIN display" className="flex justify-center gap-4">
            {[0, 1, 2, 3].map(i => (
              <span
                key={i}
                data-filled={i < digits.length ? 'true' : 'false'}
                className={`w-4 h-4 rounded-full transition-colors duration-150 ${i < digits.length ? 'bg-white' : 'bg-slate-600'}`}
                aria-hidden="true"
              />
            ))}
          </div>

          {verifying && <p className="text-center text-slate-400 text-sm">Verifying…</p>}

          {isLocked && (
            <div
              role="status"
              className="text-amber-300 text-sm text-center bg-amber-400/10 px-4 py-3 rounded-xl space-y-1"
            >
              <p className="flex items-center justify-center gap-1.5 font-semibold">
                <Clock size={14} aria-hidden="true" />
                PIN locked after too many attempts
              </p>
              <p>Try again in {remainingLabel}. Another staff member can log in meanwhile.</p>
            </div>
          )}

          {!isLocked && error && (
            <p role="alert" className="text-red-400 text-sm text-center bg-red-400/10 px-4 py-2 rounded-xl">
              {error}
            </p>
          )}

          {unreachable && (
            <div
              role="alert"
              className="text-amber-300 text-sm text-center bg-amber-400/10 px-4 py-3 rounded-xl space-y-3"
            >
              <p className="flex items-center justify-center gap-1.5 font-semibold">
                <WifiOff size={14} aria-hidden="true" />
                Could not check the PIN — no connection
              </p>
              <p>Try again, or carry on as {activeStaff.name}. Carrying on without a PIN is recorded.</p>
              <button
                onClick={carryOnUnverified}
                className="w-full bg-amber-600 hover:bg-amber-500 text-white font-semibold py-3 rounded-xl
                  transition-colors cursor-pointer min-h-[44px]"
              >
                Carry on without checking the PIN
              </button>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            {PIN_KEYS.map(key => (
              <button
                key={key}
                onClick={() => handleKey(key)}
                disabled={verifying || isLocked}
                aria-label={key === 'back' ? 'Backspace' : key === 'clear' ? 'Clear PIN' : key}
                className="bg-slate-800 hover:bg-slate-700 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-5 rounded-2xl text-2xl transition-all duration-150 cursor-pointer flex items-center justify-center border border-slate-700"
              >
                {key === 'back' && <Delete size={22} aria-hidden="true" />}
                {key === 'clear' && <X size={22} aria-hidden="true" />}
                {key !== 'back' && key !== 'clear' && key}
              </button>
            ))}
          </div>

          <button
            onClick={() => { setMode('someone_else'); setDigits(''); setError(null) }}
            disabled={verifying}
            className="w-full flex items-center justify-center gap-2 min-h-[48px] rounded-xl border border-slate-700
              text-slate-300 hover:bg-slate-800 hover:text-white transition-colors cursor-pointer text-sm font-medium
              disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Users size={16} aria-hidden="true" />
            Someone else
          </button>
        </div>
      )}
    </div>
  )
}
