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
      className="ui-btn ui-btn-warn ui-btn-lg w-full py-2 px-4 whitespace-normal text-center leading-tight"
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
      className="fixed inset-0 z-[200] bg-[#121314] flex flex-col md:flex-row overflow-auto focus:outline-none"
    >
      {mode === 'someone_else' ? (
        // A full sign-in: opens the new person's session (ending the previous
        // one on the server) and, through setActiveStaff, unlocks the till.
        <PinLoginScreen
          onBack={() => setMode('pin')}
          onSignedIn={() => logEvent('till.unlocked', { via: 'sign_in' }, { severity: 0 })}
        />
      ) : (
        // Laid out as the staff sign-in is (PinLoginScreen): who it is about
        // on the left, the PIN and its keypad on the right.
        <>
          <section className="md:w-[44%] md:max-w-[560px] shrink-0 bg-slate-900 border-b md:border-b-0 md:border-r border-slate-800
            px-6 md:px-12 py-6 md:py-12 flex flex-col gap-6 md:overflow-auto">
            <div className="flex flex-col gap-4">
              <span className="w-14 h-14 rounded-2xl bg-slate-800 text-slate-300 flex items-center justify-center" aria-hidden="true">
                <Lock size={28} />
              </span>
              <h1 className="text-white text-3xl md:text-[40px] font-extrabold tracking-tight leading-none">Till Locked</h1>
              <p className="text-slate-300 text-xl leading-snug">
                Enter PIN for <span className="text-white font-bold">{activeStaff.name}</span> to carry on
              </p>
            </div>

            {isLocked && (
              <div role="status" className="ui-banner ui-banner-warn flex-col flex-nowrap items-stretch text-base">
                <p className="flex items-center gap-2 text-amber-100 font-bold">
                  <Clock size={18} aria-hidden="true" className="shrink-0" />
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

            {!isLocked && unreachable && (
              <div role="alert" className="ui-banner ui-banner-warn flex-col flex-nowrap items-stretch text-base">
                <p className="flex items-center gap-2 text-amber-100 font-bold">
                  <WifiOff size={18} aria-hidden="true" className="shrink-0" />
                  Can’t check the PIN — the till can’t reach the server
                </p>
                <p>
                  Try the PIN again, or carry on as {activeStaff.name} without it.
                  {' '}{CARRY_ON_WARNING}
                </p>
                {carryOnButton}
              </div>
            )}

            <button
              onClick={chooseSomeoneElse}
              disabled={verifying}
              className="ui-btn ui-btn-secondary ui-btn-lg w-full md:mt-auto"
            >
              <Users size={20} aria-hidden="true" />
              Someone else
            </button>
          </section>

          <section className="flex-1 min-w-0 px-6 md:px-16 py-6 md:py-12 flex flex-col gap-5 max-w-2xl md:mx-auto w-full">
            <div className="flex items-center justify-between gap-4 min-h-[64px]">
              <div className="min-w-0">
                <div className="text-white text-2xl font-extrabold break-words">{activeStaff.name}’s PIN</div>
                <div className="text-slate-400 text-[15px]">Unlocks on the fourth digit</div>
              </div>
              <div aria-label="PIN display" className="flex gap-3.5 shrink-0">
                {[0, 1, 2, 3].map(i => (
                  <span
                    key={i}
                    data-filled={i < digits.length ? 'true' : 'false'}
                    className={`w-6 h-6 rounded-full border-2 transition-colors duration-150
                      ${i < digits.length ? 'bg-slate-100 border-slate-100' : 'border-slate-400'}`}
                    aria-hidden="true"
                  />
                ))}
              </div>
            </div>

            {verifying && <p className="text-slate-400 text-base">Verifying…</p>}

            {!isLocked && error && (
              <p role="alert" className="ui-banner ui-banner-bad text-base">
                {error}
              </p>
            )}

            <div className="grid grid-cols-3 gap-3">
              {PIN_KEYS.map(key => (
                <button
                  key={key}
                  onClick={() => handleKey(key)}
                  disabled={verifying || isLocked}
                  aria-label={key === 'back' ? 'Backspace' : key === 'clear' ? 'Clear PIN' : key}
                  className="min-h-[84px] md:min-h-[112px] rounded-2xl bg-slate-800 hover:bg-slate-700 active:scale-95
                    disabled:opacity-40 disabled:cursor-not-allowed text-white text-4xl font-bold
                    transition-all duration-150 cursor-pointer flex items-center justify-center"
                >
                  {key === 'back' && <Delete size={28} aria-hidden="true" />}
                  {key === 'clear' && <X size={28} aria-hidden="true" />}
                  {key !== 'back' && key !== 'clear' && key}
                </button>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  )
}
