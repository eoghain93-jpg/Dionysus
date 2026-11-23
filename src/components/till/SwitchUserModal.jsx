import { useState, useEffect } from 'react'
import { X, Delete, Clock } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useSessionStore } from '../../stores/sessionStore'
import { useLockoutCountdown } from '../../hooks/useLockoutCountdown'

const PIN_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'clear']

function initials(name) {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

export default function SwitchUserModal({ onClose }) {
  const { setActiveStaff } = useSessionStore()
  const [staffList, setStaffList] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null) // { id, name }
  const [digits, setDigits] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState(null)
  const [fetchError, setFetchError] = useState(false)
  const { isLocked, remainingLabel, lock } = useLockoutCountdown()

  useEffect(() => {
    supabase
      .from('members')
      .select('id, name')
      .eq('membership_tier', 'staff')
      .order('name')
      .then(({ data, error: fetchErr }) => {
        if (fetchErr) setFetchError(true)
        else setStaffList(data ?? [])
        setLoading(false)
      })
      .catch(() => { setFetchError(true); setLoading(false) })
  }, [])

  useEffect(() => {
    if (digits.length === 4 && selected) handleVerify()
  }, [digits, selected])

  function handleKey(key) {
    if (verifying || isLocked) return
    setError(null)
    if (key === 'back') setDigits(d => d.slice(0, -1))
    else if (key === 'clear') setDigits('')
    else setDigits(d => d.length < 4 ? d + key : d)
  }

  function selectStaff(member) {
    setSelected(member)
    setDigits('')
    setError(null)
    lock(0) // a lock belongs to one person's PIN; someone else can still sign in
  }

  async function handleVerify() {
    setVerifying(true)
    setError(null)
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('verify-pin', {
        body: { member_id: selected.id, pin: digits },
      })
      if (invokeError || !data) {
        setError('Something went wrong')
      } else if (data.valid) {
        setActiveStaff(data.member)
        onClose()
        return
      } else if (data.reason === 'locked') {
        // Too many wrong attempts: show the countdown, not "Incorrect PIN".
        lock(data.retryAfterSeconds)
      } else if (data.reason === 'no_pin') {
        setError('No PIN set for this staff member. Set one from the Members page.')
      } else {
        setError('Incorrect PIN')
      }
      setDigits('')
    } catch {
      setError('Something went wrong')
      setDigits('')
    } finally {
      setVerifying(false)
    }
  }

  return (
    <div className="ui-modal-backdrop">
      <div className="ui-modal">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <h2 className="ui-modal-title">
            Switch User
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="ui-btn ui-btn-ghost ui-btn-icon shrink-0"
          >
            <X size={22} aria-hidden="true" />
          </button>
        </div>

        {loading ? (
          <p className="ui-empty">Loading staff…</p>
        ) : fetchError ? (
          <p role="alert" className="text-red-300 text-base font-semibold bg-red-400/10 px-4 py-3 rounded-xl">
            Could not load staff list. Close this and try again.
          </p>
        ) : !selected ? (
          /* Staff selection */
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {staffList.map(member => (
              <button
                key={member.id}
                onClick={() => selectStaff(member)}
                className="min-h-[68px] px-4 rounded-2xl bg-slate-800 hover:bg-slate-700 text-left text-white
                  flex items-center gap-3 cursor-pointer transition-colors
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
              >
                <span
                  aria-hidden="true"
                  className="w-10 h-10 shrink-0 rounded-full bg-slate-600 text-white text-[15px] font-extrabold flex items-center justify-center"
                >
                  {initials(member.name)}
                </span>
                <span className="text-lg font-bold truncate">{member.name}</span>
              </button>
            ))}
          </div>
        ) : (
          /* PIN entry */
          <>
            <div className="flex items-center gap-3">
              <button
                onClick={() => { setSelected(null); setDigits(''); setError(null) }}
                className="ui-btn ui-btn-ghost shrink-0"
              >
                ← Back
              </button>
              <span className="text-white text-xl font-extrabold truncate">{selected.name}</span>
            </div>

            <div aria-label="PIN display" className="flex justify-center gap-3.5 py-2">
              {[0, 1, 2, 3].map(i => (
                <span
                  key={i}
                  className={`w-6 h-6 rounded-full border-2 transition-colors duration-150
                    ${i < digits.length ? 'bg-slate-100 border-slate-100' : 'border-slate-400'}`}
                  aria-hidden="true"
                />
              ))}
            </div>

            {isLocked && (
              <div role="status" className="text-amber-300 text-base bg-amber-400/10 px-4 py-3 rounded-xl space-y-1">
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

            <div className="grid grid-cols-3 gap-2.5">
              {PIN_KEYS.map(key => (
                <button
                  key={key}
                  onClick={() => handleKey(key)}
                  disabled={verifying || isLocked}
                  aria-label={key === 'back' ? 'Backspace' : key === 'clear' ? 'Clear PIN' : key}
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
          </>
        )}
      </div>
    </div>
  )
}
