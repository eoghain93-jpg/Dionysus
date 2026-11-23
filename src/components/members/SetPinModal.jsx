import { useState, useEffect, useCallback, useId, useRef } from 'react'
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
 *   member           — member object (must be membership_tier === 'staff')
 *   onClose          — () => void
 *   onSaved          — () => void, called after PIN is successfully set
 *   requireCurrentPin — boolean (default false). When true, adds a "current PIN" step
 *                       before the new PIN entry. Pass true from MemberProfile (change flow).
 */
export default function SetPinModal({ member, onClose, onSaved, requireCurrentPin = false }) {
  const titleId = useId()
  const overlayRef = useRef(null)

  // Steps: requireCurrentPin=false → 1=new, 2=confirm
  //        requireCurrentPin=true  → 0=current, 1=new, 2=confirm
  const [step, setStep] = useState(requireCurrentPin ? 0 : 1)
  const [currentPin, setCurrentPin] = useState('')
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

  const handleFourDigits = useCallback((pin) => {
    if (step === 0) {
      // Step 0: collected current PIN — advance to new PIN entry
      setCurrentPin(pin)
      setDigits('')
      setStep(1)
    } else if (step === 1) {
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
        setStep(requireCurrentPin ? 0 : 1)
        setCurrentPin('')
      }
    }
  }, [step, firstPin, requireCurrentPin]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-advance once all 4 digits are entered
  useEffect(() => {
    if (digits.length === 4) {
      handleFourDigits(digits)
    }
  }, [digits, handleFourDigits])

  function handleKey(key) {
    if (saving || success) return
    setError(null)
    if (key === 'back') {
      setDigits(d => d.slice(0, -1))
    } else if (key === 'clear') {
      setDigits('')
    } else {
      setDigits(d => (d.length < 4 ? d + key : d))
    }
  }

  async function handleSave(pin) {
    setSaving(true)
    setError(null)
    try {
      const reqBody = { member_id: member.id, pin, mode: 'set' }
      if (currentPin) reqBody.current_pin = currentPin
      const { data, error: invokeError } = await supabase.functions.invoke('verify-pin', { body: reqBody })

      if (invokeError || !data?.success) {
        setError('Failed to set PIN. Please try again.')
        setDigits('')
        setFirstPin('')
        setCurrentPin('')
        setStep(requireCurrentPin ? 0 : 1)
        return
      }

      setSuccess(true)
      // Give a brief moment for the user to see the success message
      setTimeout(() => onSaved(), 1500)
    } catch {
      setError('Failed to set PIN. Please try again.')
      setDigits('')
      setFirstPin('')
      setCurrentPin('')
      setStep(requireCurrentPin ? 0 : 1)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      ref={overlayRef}
      className="ui-modal-backdrop"
      onClick={handleOverlayClick}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="ui-modal"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <KeyRound size={24} className="text-slate-400 shrink-0" aria-hidden="true" />
            <h2
              id={titleId}
              className="ui-modal-title"
            >
              Set PIN — {member.name}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close modal"
            className="ui-btn ui-btn-ghost ui-btn-icon shrink-0"
          >
            <X size={22} aria-hidden="true" />
          </button>
        </div>

        {/* Step indicator */}
        <p className={`text-lg font-bold text-center ${success ? 'text-emerald-300' : 'text-slate-100'}`}>
          {success
            ? 'PIN set successfully!'
            : step === 0
              ? 'Enter current PIN'
              : step === 1
                ? 'Enter new PIN'
                : 'Confirm new PIN'}
        </p>

        {/* PIN dot display */}
        <div
          aria-label="PIN display"
          className="flex justify-center gap-3.5 py-2"
        >
          {[0, 1, 2, 3].map(i => (
            <span
              key={i}
              data-filled={i < digits.length ? 'true' : 'false'}
              className={`w-6 h-6 rounded-full border-2 transition-colors duration-150 ${
                i < digits.length ? 'bg-slate-100 border-slate-100' : 'border-slate-400'
              }`}
              aria-hidden="true"
            />
          ))}
        </div>

        {/* Saving indicator */}
        {saving && (
          <p className="text-center text-slate-400 text-base">Saving…</p>
        )}

        {/* Error */}
        {error && (
          <p role="alert" className="text-red-300 text-base font-semibold bg-red-400/10 px-4 py-3 rounded-xl">
            {error}
          </p>
        )}

        {/* Numpad */}
        {!success && (
          <div className="grid grid-cols-3 gap-2.5">
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
                className="min-h-[72px] rounded-2xl bg-slate-800 hover:bg-slate-700 active:scale-95
                  disabled:opacity-40 disabled:cursor-not-allowed text-white text-3xl font-bold
                  transition-all duration-150 cursor-pointer flex items-center justify-center"
              >
                {key === 'back' && <Delete size={26} aria-hidden="true" />}
                {key === 'clear' && <X size={26} aria-hidden="true" />}
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
            className="ui-btn ui-btn-ghost ui-btn-lg w-full"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  )
}
