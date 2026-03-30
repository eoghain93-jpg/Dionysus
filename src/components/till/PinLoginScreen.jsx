import { useState, useEffect } from 'react'
import { Delete, X, Lock } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useSessionStore } from '../../stores/sessionStore'
import SetPinModal from '../members/SetPinModal'

const PIN_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'clear']

export default function PinLoginScreen() {
  const [staffList, setStaffList] = useState([])
  const [loadingStaff, setLoadingStaff] = useState(true)
  const [selectedId, setSelectedId] = useState('')
  const [digits, setDigits] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState(null)
  const [fetchError, setFetchError] = useState(null)
  const [showSetPin, setShowSetPin] = useState(false)

  const { setActiveStaff } = useSessionStore()

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

  useEffect(() => {
    if (digits.length === 4 && selectedId) {
      handleVerify(selectedId, digits)
    }
  }, [digits, selectedId])

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
        setActiveStaff(data.member)
      } else if (data.reason === 'no_pin') {
        setDigits('')
        setShowSetPin(true)
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

  const selectedMember = staffList.find(s => s.id === selectedId) ?? null

  return (
    <div className="fixed inset-0 bg-slate-900 flex items-center justify-center z-50 p-4">
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
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center">
            <Lock size={32} className="text-slate-400" aria-hidden="true" />
          </div>
          <h1 className="text-white text-2xl font-bold">Staff Login</h1>
          <p className="text-slate-400 text-sm">Select your name and enter your PIN</p>
        </div>

        {loadingStaff ? (
          <div className="text-slate-400 text-sm text-center">Loading staff…</div>
        ) : fetchError ? (
          <p role="alert" className="text-red-400 text-sm text-center bg-red-400/10 px-4 py-2 rounded-xl">
            {fetchError}
          </p>
        ) : staffList.length === 0 ? (
          <p className="text-slate-400 text-sm text-center">
            No staff members found. Add a staff member in the Members page.
          </p>
        ) : (
          <div className="space-y-1">
            <label htmlFor="pin-staff-select" className="block text-sm font-medium text-slate-300">
              Staff Member
            </label>
            <select
              id="pin-staff-select"
              value={selectedId}
              onChange={e => { setSelectedId(e.target.value); setDigits(''); setError(null) }}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white min-h-[44px] focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
              aria-label="Staff Member"
            >
              <option value="">— Select staff member —</option>
              {staffList.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        )}

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

        {error && (
          <p role="alert" className="text-red-400 text-sm text-center bg-red-400/10 px-4 py-2 rounded-xl">
            {error}
          </p>
        )}

        <div className="grid grid-cols-3 gap-3">
          {PIN_KEYS.map(key => (
            <button
              key={key}
              onClick={() => handleKey(key)}
              disabled={verifying}
              aria-label={key === 'back' ? 'Backspace' : key === 'clear' ? 'Clear PIN' : key}
              className="bg-slate-800 hover:bg-slate-700 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-5 rounded-2xl text-2xl transition-all duration-150 cursor-pointer flex items-center justify-center border border-slate-700"
            >
              {key === 'back' && <Delete size={22} aria-hidden="true" />}
              {key === 'clear' && <X size={22} aria-hidden="true" />}
              {key !== 'back' && key !== 'clear' && key}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
