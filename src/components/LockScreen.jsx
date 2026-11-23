import { useState, useEffect, useCallback, useRef } from 'react'
import { Delete, X, Lock, Clock, Users, WifiOff } from 'lucide-react'
import { signInStaff, signOutStaff } from '../lib/audit/staff'
import { getStaffSession, clearStaffSession } from '../lib/audit/staffSession'
import { markReached, markUnreachable, serverUnreachable } from '../lib/audit/reachability'
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

// Said next to every offer to carry on without a PIN: staff must know it is
// not a quiet shortcut.
const CARRY_ON_WARNING = 'This is recorded and shown to the owner.'

// A sign-in whose answer comes when it can no longer open the till (the lock
// screen has gone, or moved on to another try) has still opened a server
// session for that person and put its token in memory. It may stay only if
// that person is the one now using the till and got in with a checked PIN;
// otherwise it is ended, so nothing is recorded under a PIN that did not
// open the till.
function settleUnusedSignIn(memberId, carriedOn) {
  if (getStaffSession()?.staffId !== memberId) return
  const { activeStaff, locked } = useSessionStore.getState()
  if (!carriedOn && !locked && activeStaff?.id === memberId) return
  signOutStaff('unused_unlock') // never rejects; ends it on the server and forgets the token
}

/**
 * LockScreen — shown by StaffGate while the till is locked (idle timeout or
 * the Lock button). The page underneath stays mounted but hidden and inert,
 * so the open order and anything half-entered are exactly as they were left.
 *
 * Locking ended the person's server session (useIdleLock.lockTill), so a
 * locked till holds no sign-in at all. Ways back in:
 *   - the person whose till it is enters their PIN. That is a full sign-in
 *     (signInStaff): the database checks the PIN and opens a fresh session;
 *   - "Someone else" — the normal staff sign-in. The open order stays, as
 *     it does on Switch User;
 *   - "Carry on without checking the PIN", for the same person only, and
 *     offered only when their PIN cannot do the job:
 *       · the check could not reach the server (it REJECTED or never
 *         answered — or the till already knows the server is unreachable), or
 *       · the server answered that the PIN is locked out (five wrong tries
 *         anywhere lock it for 15 minutes, and a sole bartender must still
 *         be able to serve).
 *     Never after a plain wrong PIN. It is recorded for the owner, and it
 *     opens NO server session: what follows is logged as "said to be" that
 *     person, not "PIN checked", until a PIN is next accepted.
 *
 * So the lock can never leave a till nobody can use, and getting past it
 * without a PIN is always on the record.
 */
export default function LockScreen() {
  const activeStaff = useSessionStore(s => s.activeStaff)
  const unlock = useSessionStore(s => s.unlock)

  const [mode, setMode] = useState('pin') // 'pin' | 'someone_else'
  const [digits, setDigits] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState(null)
  // True when the PIN cannot be checked: a check on this screen got no
  // answer, or the till already knew it when the screen opened — staff are
  // not made to wait out the same dead connection at every lock.
  const [unreachable, setUnreachable] = useState(
    () => serverUnreachable() || globalThis.navigator?.onLine === false
  )
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

  // Only the latest PIN try can open the till. Bumped by each try, and by
  // anything that abandons one (Someone else, carrying on unchecked).
  const tryRef = useRef(0)
  const carriedOnRef = useRef(false)

  const handleVerify = useCallback(async (memberId, pin) => {
    const thisTry = ++tryRef.current
    const stillWanted = () => {
      const now = useSessionStore.getState()
      return shownRef.current && tryRef.current === thisTry && now.locked && now.activeStaff?.id === memberId
    }

    // What the server said, whenever it says it.
    function onAnswer(data) {
      markReached() // a PIN can be checked again (the fallback check is not a database request)
      if (!stillWanted()) {
        if (data?.valid) settleUnusedSignIn(memberId, carriedOnRef.current)
        return
      }
      // The server answered, so its answer decides.
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
    }

    setVerifying(true)
    setError(null)
    // A sign-in, not a bare PIN check: the lock ended the server session,
    // and a correct PIN opens a new one.
    const check = (async () => signInStaff(memberId, pin))()
    let answer
    let answered = false
    try {
      answer = await withTimeout(check, UNLOCK_CHECK_TIMEOUT_MS)
      answered = true
    } catch {
      // Neither the database nor the fallback could be reached, or neither
      // answered in time. Remember it: the till stops auto-locking and the
      // next lock screen offers to carry on straight away.
      markUnreachable()
      if (stillWanted()) {
        setUnreachable(true)
        setDigits('')
      }
      // If it was only slow, the answer still counts when it comes.
      check.then(onAnswer, () => {})
    }
    if (shownRef.current) setVerifying(false)
    if (answered) onAnswer(answer)
  }, [unlock, lock])

  function handleKey(key) {
    if (verifying || isLocked) return
    setError(null)
    if (key === 'back') {
      setDigits(d => d.slice(0, -1))
    } else if (key === 'clear') {
      setDigits('')
    } else if (digits.length < 4) {
      const next = digits + key
      setDigits(next)
      // The fourth digit submits.
      if (next.length === 4 && activeStaff) handleVerify(activeStaff.id, next)
    }
  }

  function carryOnUnverified() {
    const pinLocked = isLocked
    tryRef.current += 1 // an answer still on its way opens nothing now
    carriedOnRef.current = true
    // Nobody's PIN was accepted, so no server session may carry on. (The
    // lock already ended it; this makes sure.) Cleared BEFORE the event is
    // written so that the event, too, is only "said to be" this person.
    clearStaffSession()
    logEvent(
      'till.unlocked_unverified',
      { reason: pinLocked ? 'pin_locked' : 'unreachable' },
      { severity: pinLocked ? 3 : 2 }
    )
    unlock()
  }

  function chooseSomeoneElse() {
    tryRef.current += 1
    setMode('someone_else')
    setDigits('')
    setError(null)
  }

  if (!activeStaff) return null

  const carryOnButton = (
    <button
      onClick={carryOnUnverified}
      className="w-full bg-amber-600 hover:bg-amber-500 text-white font-semibold py-3 rounded-xl
        transition-colors cursor-pointer min-h-[44px]"
    >
      Carry on without checking the PIN
    </button>
  )

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
              className="text-amber-300 text-sm text-center bg-amber-400/10 px-4 py-3 rounded-xl space-y-3"
            >
              <p className="flex items-center justify-center gap-1.5 font-semibold">
                <Clock size={14} aria-hidden="true" />
                PIN locked after too many attempts
              </p>
              <p>Try again in {remainingLabel}, or someone else can sign in.</p>
              <p>
                Need to serve now? You can carry on as {activeStaff.name} without the PIN.
                {' '}{CARRY_ON_WARNING}
              </p>
              {carryOnButton}
            </div>
          )}

          {!isLocked && error && (
            <p role="alert" className="text-red-400 text-sm text-center bg-red-400/10 px-4 py-2 rounded-xl">
              {error}
            </p>
          )}

          {!isLocked && unreachable && (
            <div
              role="alert"
              className="text-amber-300 text-sm text-center bg-amber-400/10 px-4 py-3 rounded-xl space-y-3"
            >
              <p className="flex items-center justify-center gap-1.5 font-semibold">
                <WifiOff size={14} aria-hidden="true" />
                Can’t check the PIN — the till can’t reach the server
              </p>
              <p>
                Try the PIN again, or carry on as {activeStaff.name} without it.
                {' '}{CARRY_ON_WARNING}
              </p>
              {carryOnButton}
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
            onClick={chooseSomeoneElse}
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
