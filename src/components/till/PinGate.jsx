import { useState, useEffect, useCallback, useRef } from 'react'
import { Delete, X, ShieldCheck, Clock } from 'lucide-react'
import { verifyStaffPin } from '../../lib/audit/staff'
import { logEvent } from '../../lib/audit/log'
import { useSessionStore } from '../../stores/sessionStore'
import { useLockoutCountdown } from '../../hooks/useLockoutCountdown'

const PIN_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'clear']

// What the PIN is being asked for, as a short machine word for the audit
// log. Callers should pass `purpose`; otherwise it is derived from the label
// ("Confirm Price Change" -> "confirm_price_change").
function pinGatePurpose(purpose, label) {
  const slug = String(purpose || label || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80)
  return slug || 'confirm'
}

/**
 * PinGate — require PIN re-entry before a privileged action.
 *
 * Does NOT change the session. Calls onConfirm() only after successful verify.
 * The check is made by the database (verifyStaffPin), which records who was
 * asked, what for (`purpose`) and whether the PIN was right.
 *
 * Props:
 *   onConfirm  — () => void, called after PIN verified
 *   onCancel   — () => void, called when user dismisses
 *   label      — string, action name shown in header (optional)
 *   purpose    — string, short machine word for the log: 'z_report',
 *                'price_change', 'fix_payment', 'undo_tab_payment' ...
 *                (optional; derived from label when absent)
 */
export default function PinGate({ onConfirm, onCancel, label, purpose }) {
  const [digits, setDigits] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState(null)
  const { isLocked, remainingLabel, lock } = useLockoutCountdown()

  const activeStaff = useSessionStore(s => s.activeStaff)
  const logPurpose = pinGatePurpose(purpose, label)

  // Kept in a ref so a parent re-render (a new inline onConfirm) can never
  // re-run the auto-submit effect and send the same PIN twice.
  const onConfirmRef = useRef(onConfirm)
  useEffect(() => { onConfirmRef.current = onConfirm }, [onConfirm])

  // Bumped when the gate is cancelled or goes away: a PIN check still in
  // flight at that moment must not go on to confirm the action.
  const attemptRef = useRef(0)
  useEffect(() => () => { attemptRef.current += 1 }, [])

  const handleVerify = useCallback(async (memberId, pin) => {
    setVerifying(true)
    setError(null)
    const attempt = attemptRef.current
    try {
      // Resolves with the verify-pin response shape; rejects only when the
      // server could not be reached at all.
      const data = await verifyStaffPin(memberId, pin, logPurpose)

      if (!data) {
        setError('Something went wrong. Please try again.')
        setDigits('')
        return
      }

      if (data.valid) {
        if (attempt === attemptRef.current) onConfirmRef.current()
      } else if (data.reason === 'locked') {
        setDigits('')
        lock(data.retryAfterSeconds)
      } else {
        setError('Incorrect PIN. Please try again.')
        setDigits('')
      }
    } catch {
      setError('Something went wrong. Please try again.')
      setDigits('')
    } finally {
      setVerifying(false)
    }
  }, [logPurpose, lock])

  // The server records every PIN it checks; walking away from the prompt
  // reaches no server, so the till reports that itself.
  function handleCancel() {
    attemptRef.current += 1
    logEvent('pin_gate.cancelled', { purpose: logPurpose })
    onCancel()
  }

  // Auto-submit when 4 digits entered
  useEffect(() => {
    if (digits.length === 4 && activeStaff) {
      handleVerify(activeStaff.id, digits)
    }
  }, [digits, activeStaff, handleVerify])

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

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-2xl p-6 w-full max-w-sm space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck size={20} className="text-slate-400" aria-hidden="true" />
            <h2 className="text-white text-lg font-bold">
              {label ?? 'Confirm Identity'}
            </h2>
          </div>
          <button
            onClick={handleCancel}
            aria-label="Dismiss"
            className="text-slate-400 hover:text-white transition-colors cursor-pointer
              min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        {/* Staff name */}
        {activeStaff && (
          <p className="text-slate-400 text-sm">
            Enter PIN for <span className="text-white font-semibold">{activeStaff.name}</span>
          </p>
        )}

        {/* PIN dot display */}
        <div
          aria-label="PIN display"
          className="flex justify-center gap-4 py-2"
        >
          {[0, 1, 2, 3].map(i => (
            <span
              key={i}
              data-filled={i < digits.length ? 'true' : 'false'}
              className={`w-4 h-4 rounded-full transition-colors duration-150 ${
                i < digits.length ? 'bg-white' : 'bg-slate-600'
              }`}
              aria-hidden="true"
            />
          ))}
        </div>

        {/* Verifying */}
        {verifying && (
          <p className="text-center text-slate-400 text-sm">Verifying…</p>
        )}

        {/* Locked — calm countdown, not an error: the lock protects the PIN
            and resolves itself; staff just need to know when */}
        {isLocked && (
          <div
            role="status"
            className="text-amber-300 text-sm text-center bg-amber-400/10 px-4 py-3 rounded-xl space-y-1"
          >
            <p className="flex items-center justify-center gap-1.5 font-semibold">
              <Clock size={14} aria-hidden="true" />
              PIN locked after too many attempts
            </p>
            <p>Try again in {remainingLabel}, or cancel and ask another staff member.</p>
          </div>
        )}

        {/* Error */}
        {!isLocked && error && (
          <p role="alert" className="text-red-400 text-sm text-center bg-red-400/10 px-4 py-2 rounded-xl">
            {error}
          </p>
        )}

        {/* Numpad */}
        <div className="grid grid-cols-3 gap-2">
          {PIN_KEYS.map(key => (
            <button
              key={key}
              onClick={() => handleKey(key)}
              disabled={verifying || isLocked}
              aria-label={
                key === 'back' ? 'Backspace' :
                key === 'clear' ? 'Clear PIN' :
                key
              }
              className="bg-slate-700 hover:bg-slate-600 active:scale-95 disabled:opacity-40
                disabled:cursor-not-allowed text-white font-semibold py-4 rounded-xl text-xl
                transition-all duration-150 cursor-pointer flex items-center justify-center"
            >
              {key === 'back' && <Delete size={20} aria-hidden="true" />}
              {key === 'clear' && <X size={20} aria-hidden="true" />}
              {key !== 'back' && key !== 'clear' && key}
            </button>
          ))}
        </div>

        {/* Cancel button */}
        <button
          onClick={handleCancel}
          className="w-full bg-slate-700 hover:bg-slate-600 text-white font-semibold
            py-3 rounded-xl transition-colors cursor-pointer"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
