import { useState, useEffect, useCallback, useRef } from 'react'
import { Delete, X, Clock, ArrowLeft } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { signInStaff } from '../../lib/audit/staff'
import { useSessionStore } from '../../stores/sessionStore'
import { useLockoutCountdown } from '../../hooks/useLockoutCountdown'
import SetPinModal from '../members/SetPinModal'

const PIN_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'clear']

/**
 * PinLoginScreen — the staff sign-in. Shown by StaffGate on every route
 * while nobody is signed in, and by the lock screen's "Someone else".
 *
 * The PIN is checked by signInStaff (database first, verify-pin as the
 * fallback), which also opens the server-side staff session.
 *
 * Props (all optional):
 *   onBack     — () => void. When given, a "Back" button is shown.
 *   onSignedIn — (member) => void, called after a successful sign-in.
 */
export default function PinLoginScreen({ onBack, onSignedIn } = {}) {
  const [staffList, setStaffList] = useState([])
  const [loadingStaff, setLoadingStaff] = useState(true)
  const [selectedId, setSelectedId] = useState('')
  const [digits, setDigits] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState(null)
  const [fetchError, setFetchError] = useState(null)
  const [showSetPin, setShowSetPin] = useState(false)
  const { isLocked, remainingLabel, lock } = useLockoutCountdown()

  const { setActiveStaff } = useSessionStore()

  // Kept in a ref so a parent re-render (a new inline callback) can never
  // re-run the auto-submit effect and send the same PIN twice.
  const onSignedInRef = useRef(onSignedIn)
  useEffect(() => { onSignedInRef.current = onSignedIn }, [onSignedIn])

  useEffect(() => {
    supabase
      .from('members')
      .select('id, name, membership_tier')
      .eq('membership_tier', 'staff')
      .order('name')
      .then(({ data, error: fetchErr }) => {
        if (fetchErr) {
          setFetchError('Could not load staff list. Please refresh.')
        } else {
          setStaffList(data ?? [])
        }
        setLoadingStaff(false)
      })
      .catch(() => {
        setFetchError('Could not load staff list. Please refresh.')
        setLoadingStaff(false)
      })
  }, [])

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

  const handleVerify = useCallback(async (memberId, pin) => {
    setVerifying(true)
    setError(null)
    try {
      // Resolves with the verify-pin response shape; rejects only when the
      // server could not be reached at all.
      const data = await signInStaff(memberId, pin)
      if (!data) {
        setError('Something went wrong. Please try again.')
        setDigits('')
        return
      }
      if (data.valid) {
        setActiveStaff(data.member)
        onSignedInRef.current?.(data.member)
      } else if (data.reason === 'no_pin') {
        setDigits('')
        setShowSetPin(true)
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
  }, [setActiveStaff, lock])

  // Auto-submit when 4 digits entered
  useEffect(() => {
    if (digits.length === 4 && selectedId) {
      handleVerify(selectedId, digits)
    }
  }, [digits, selectedId, handleVerify])

  const selectedMember = staffList.find(s => s.id === selectedId) ?? null

  function initials(name) {
    return name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() ?? '?'
  }

  return (
    <div className="fixed inset-0 bg-[#121314] flex flex-col md:flex-row z-50 overflow-auto">
      {showSetPin && selectedMember && (
        <SetPinModal
          member={selectedMember}
          onClose={() => setShowSetPin(false)}
          onSaved={() => {
            setShowSetPin(false)
            setError(null)
          }}
        />
      )}

      <section className="md:w-[44%] md:max-w-[560px] shrink-0 bg-slate-900 border-b md:border-b-0 md:border-r border-slate-800
        px-6 md:px-12 py-6 md:py-12 flex flex-col gap-6 md:overflow-auto">
        {onBack && (
          <button onClick={onBack} className="ui-btn ui-btn-ghost self-start">
            <ArrowLeft size={18} aria-hidden="true" />
            Back
          </button>
        )}
        <h1 className="text-white text-3xl md:text-[40px] font-extrabold tracking-tight leading-none">
          Who&rsquo;s on the bar?
        </h1>
        {loadingStaff ? (
          <div className="text-slate-400 text-base">Loading staff…</div>
        ) : fetchError ? (
          <p role="alert" className="text-red-300 text-base bg-red-400/10 px-4 py-3 rounded-xl">
            {fetchError}
          </p>
        ) : staffList.length === 0 ? (
          <p className="text-slate-400 text-base">
            No staff members found. Add a staff member in the Members page.
          </p>
        ) : (
          <div role="group" aria-label="Staff member" className="grid grid-cols-2 gap-3">
            {staffList.map(s => {
              const active = s.id === selectedId
              return (
                <button
                  key={s.id}
                  onClick={() => { setSelectedId(s.id); setDigits(''); setError(null) }}
                  aria-pressed={active}
                  className={`min-h-[76px] px-4 rounded-2xl border-[1.5px] text-left text-white flex items-center gap-3.5
                    cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400
                    ${active ? 'bg-blue-950 border-blue-300' : 'bg-slate-800 border-slate-800 hover:bg-slate-700'}`}
                >
                  <span
                    aria-hidden="true"
                    className={`w-11 h-11 shrink-0 rounded-full text-white text-base font-extrabold flex items-center justify-center
                      ${active ? 'bg-blue-600' : 'bg-slate-600'}`}
                  >
                    {initials(s.name)}
                  </span>
                  <span className="text-xl font-bold truncate">{s.name}</span>
                </button>
              )
            })}
          </div>
        )}
      </section>

      <section className="flex-1 min-w-0 px-6 md:px-16 py-6 md:py-12 flex flex-col gap-5 max-w-2xl md:mx-auto w-full">
        <div className="flex items-center justify-between gap-4 min-h-[64px]">
          <div>
            <div className="text-white text-2xl font-extrabold">
              {selectedMember ? `${selectedMember.name}’s PIN` : 'Pick your name first'}
            </div>
            <div className="text-slate-400 text-[15px]">Signs you in on the fourth digit</div>
          </div>
          <div aria-label="PIN display" className="flex gap-3.5">
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

        {/* Locked — calm countdown, not an error: the lock protects the PIN
            and resolves itself; staff just need to know when */}
        {isLocked && (
          <div
            role="status"
            className="text-amber-300 text-base bg-amber-400/10 px-4 py-3 rounded-xl space-y-1"
          >
            <p className="flex items-center gap-1.5 font-bold">
              <Clock size={16} aria-hidden="true" />
              PIN locked after too many attempts
            </p>
            <p>Try again in {remainingLabel}. Another staff member can log in meanwhile.</p>
          </div>
        )}

        {!isLocked && error && (
          <p role="alert" className="text-red-300 text-base font-semibold bg-red-400/10 px-4 py-3 rounded-xl">
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
    </div>
  )
}
