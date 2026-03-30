import { useState, useEffect } from 'react'
import { Delete, X, ShieldCheck } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useSessionStore } from '../../stores/sessionStore'

const PIN_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'clear']

/**
 * PinGate — require PIN re-entry before a privileged action.
 *
 * Does NOT change the session. Calls onConfirm() only after successful verify.
 *
 * Props:
 *   onConfirm  — () => void, called after PIN verified
 *   onCancel   — () => void, called when user dismisses
 *   label      — string, action name shown in header (optional)
 */
export default function PinGate({ onConfirm, onCancel, label }) {
  const [digits, setDigits] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState(null)

  const activeStaff = useSessionStore(s => s.activeStaff)

  // Auto-submit when 4 digits entered
  useEffect(() => {
    if (digits.length === 4 && activeStaff) {
      handleVerify(activeStaff.id, digits)
    }
  }, [digits])

  function handleKey(key) {
    if (verifying) return
    setError(null)
    if (key === 'back') {
      setDigits(d => d.slice(0, -1))
    } else if (key === 'clear') {
      setDigits('')
    } else {
      setDigits(d => d.length < 4 ? d + key : d)
    }
  }

  async function handleVerify(memberId, pin) {
    setVerifying(true)
    setError(null)
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('verify-pin', {
        body: { member_id: memberId, pin },
      })

      if (invokeError || !data) {
        setError('Something went wrong. Please try again.')
        setDigits('')
        return
      }

      if (data.valid) {
        onConfirm()
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
            onClick={onCancel}
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

        {/* Error */}
        {error && (
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
              disabled={verifying}
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
          onClick={onCancel}
          className="w-full bg-slate-700 hover:bg-slate-600 text-white font-semibold
            py-3 rounded-xl transition-colors cursor-pointer"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
