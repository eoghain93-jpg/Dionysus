import { useState, useEffect, useId, useRef } from 'react'
import { Delete, X, KeyRound } from 'lucide-react'
import { supabase } from '../../lib/supabase'

const PIN_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'clear']

/**
 * SetPinModal — allows a staff member's PIN to be set or changed.
 *
 * Two-step flow:
 *   Step 1: Enter new 4-digit PIN
 *   Step 2: Confirm PIN (re-enter)
 * If both match, calls verify-pin edge function in 'set' mode.
 *
 * Props:
 *   member    — member object (must be membership_tier === 'staff')
 *   onClose   — () => void
 *   onSaved   — () => void, called after PIN is successfully set
 */
export default function SetPinModal({ member, onClose, onSaved }) {
  const titleId = useId()
  const overlayRef = useRef(null)

  const [step, setStep] = useState(1)       // 1 = enter, 2 = confirm
  const [firstPin, setFirstPin] = useState('')
  const [digits, setDigits] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)

  // Escape to close
  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  function handleOverlayClick(e) {
    if (e.target === overlayRef.current) onClose()
  }

  function handleKey(key) {
    if (saving || success) return
    setError(null)
    if (key === 'back') {
      setDigits(d => d.slice(0, -1))
    } else if (key === 'clear') {
      setDigits('')
    } else {
      setDigits(d => {
        const next = d.length < 4 ? d + key : d
        // Auto-advance when 4th digit is pressed
        if (next.length === 4) {
          // Use setTimeout so state updates settle before we advance
          setTimeout(() => handleFourDigits(next), 0)
        }
        return next
      })
    }
  }

  function handleFourDigits(pin) {
    if (step === 1) {
      setFirstPin(pin)
      setDigits('')
      setStep(2)
    } else {
      // Step 2 — compare
      if (pin === firstPin) {
        handleSave(pin)
      } else {
        setError('PINs do not match. Please try again.')
        setDigits('')
        setFirstPin('')
        setStep(1)
      }
    }
  }

  async function handleSave(pin) {
    setSaving(true)
    setError(null)
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('verify-pin', {
        body: { member_id: member.id, pin, mode: 'set' },
      })

      if (invokeError || !data?.success) {
        setError('Failed to set PIN. Please try again.')
        setDigits('')
        setFirstPin('')
        setStep(1)
        return
      }

      setSuccess(true)
      // Give a brief moment for the user to see the success message
      setTimeout(() => onSaved(), 1500)
    } catch {
      setError('Failed to set PIN. Please try again.')
      setDigits('')
      setFirstPin('')
      setStep(1)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 overflow-y-auto"
      onClick={handleOverlayClick}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-sm bg-[#0F172A] border border-slate-700 rounded-2xl shadow-xl flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-slate-700">
          <div className="flex items-center gap-2">
            <KeyRound size={18} className="text-slate-400" aria-hidden="true" />
            <h2
              id={titleId}
              className="text-lg font-bold text-white"
            >
              Set PIN — {member.name}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close modal"
            className="text-slate-400 hover:text-white transition-colors cursor-pointer
              min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <div className="px-5 py-5 space-y-4">
          {/* Step indicator */}
          <p className="text-slate-300 text-sm text-center">
            {success
              ? 'PIN set successfully!'
              : step === 1
                ? 'Enter new PIN'
                : 'Confirm new PIN'}
          </p>

          {/* PIN dot display */}
          <div
            aria-label="PIN display"
            className="flex justify-center gap-4"
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

          {/* Saving indicator */}
          {saving && (
            <p className="text-center text-slate-400 text-sm">Saving…</p>
          )}

          {/* Error */}
          {error && (
            <p role="alert" className="text-red-400 text-sm text-center bg-red-400/10 px-4 py-2 rounded-xl">
              {error}
            </p>
          )}

          {/* Numpad */}
          {!success && (
            <div className="grid grid-cols-3 gap-2">
              {PIN_KEYS.map(key => (
                <button
                  key={key}
                  onClick={() => handleKey(key)}
                  disabled={saving || success}
                  aria-label={
                    key === 'back' ? 'Backspace' :
                    key === 'clear' ? 'Clear PIN' :
                    key
                  }
                  className="bg-slate-800 hover:bg-slate-700 active:scale-95 disabled:opacity-40
                    disabled:cursor-not-allowed text-white font-semibold py-4 rounded-xl text-xl
                    transition-all duration-150 cursor-pointer flex items-center justify-center
                    border border-slate-700"
                >
                  {key === 'back' && <Delete size={20} aria-hidden="true" />}
                  {key === 'clear' && <X size={20} aria-hidden="true" />}
                  {key !== 'back' && key !== 'clear' && key}
                </button>
              ))}
            </div>
          )}

          {/* Cancel */}
          {!success && (
            <button
              onClick={onClose}
              disabled={saving}
              className="w-full min-h-[44px] rounded-xl border border-slate-600 text-slate-300
                hover:bg-slate-700 hover:text-white transition-colors cursor-pointer text-sm font-medium
                disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
