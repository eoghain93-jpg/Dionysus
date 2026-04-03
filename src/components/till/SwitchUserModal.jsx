import { useState, useEffect } from 'react'
import { X, Delete } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useSessionStore } from '../../stores/sessionStore'

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

  useEffect(() => {
    supabase
      .from('members')
      .select('id, name')
      .eq('membership_tier', 'staff')
      .order('name')
      .then(({ data }) => { setStaffList(data ?? []); setLoading(false) })
  }, [])

  useEffect(() => {
    if (digits.length === 4 && selected) handleVerify()
  }, [digits, selected])

  function handleKey(key) {
    if (verifying) return
    setError(null)
    if (key === 'back') setDigits(d => d.slice(0, -1))
    else if (key === 'clear') setDigits('')
    else setDigits(d => d.length < 4 ? d + key : d)
  }

  function selectStaff(member) {
    setSelected(member)
    setDigits('')
    setError(null)
  }

  async function handleVerify() {
    setVerifying(true)
    setError(null)
    try {
      const { data } = await supabase.functions.invoke('verify-pin', {
        body: { member_id: selected.id, pin: digits },
      })
      if (data?.valid) {
        setActiveStaff(data.member)
        onClose()
      } else {
        setError('Incorrect PIN')
        setDigits('')
      }
    } catch {
      setError('Something went wrong')
      setDigits('')
    } finally {
      setVerifying(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-sm bg-[#0F172A] border border-slate-700 rounded-2xl shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-slate-700">
          <h2 className="text-lg font-bold text-white" style={{ fontFamily: "'Playfair Display SC', serif" }}>
            Switch User
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-slate-400 hover:text-white cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <div className="px-5 py-5 flex flex-col gap-4">
          {loading ? (
            <p className="text-slate-400 text-sm text-center">Loading staff…</p>
          ) : !selected ? (
            /* Staff selection */
            <div className="flex flex-col gap-2">
              {staffList.map(member => (
                <button
                  key={member.id}
                  onClick={() => selectStaff(member)}
                  className="flex items-center gap-3 px-4 min-h-[56px] rounded-xl bg-slate-800 hover:bg-slate-700 text-left cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <span className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm font-bold shrink-0">
                    {initials(member.name)}
                  </span>
                  <span className="text-white font-medium">{member.name}</span>
                </button>
              ))}
            </div>
          ) : (
            /* PIN entry */
            <>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => { setSelected(null); setDigits(''); setError(null) }}
                  className="text-slate-400 hover:text-white text-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-1"
                >
                  ← Back
                </button>
                <span className="text-white font-medium">{selected.name}</span>
              </div>

              <div aria-label="PIN display" className="flex justify-center gap-4">
                {[0, 1, 2, 3].map(i => (
                  <span
                    key={i}
                    className={`w-4 h-4 rounded-full transition-colors duration-150 ${i < digits.length ? 'bg-white' : 'bg-slate-600'}`}
                    aria-hidden="true"
                  />
                ))}
              </div>

              {error && (
                <p role="alert" className="text-red-400 text-sm text-center bg-red-400/10 px-3 py-2 rounded-lg">
                  {error}
                </p>
              )}

              <div className="grid grid-cols-3 gap-2">
                {PIN_KEYS.map(key => (
                  <button
                    key={key}
                    onClick={() => handleKey(key)}
                    disabled={verifying}
                    aria-label={key === 'back' ? 'Backspace' : key === 'clear' ? 'Clear PIN' : key}
                    className="bg-slate-800 hover:bg-slate-700 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-4 rounded-2xl text-xl transition-all cursor-pointer flex items-center justify-center border border-slate-700"
                  >
                    {key === 'back' && <Delete size={20} aria-hidden="true" />}
                    {key === 'clear' && <X size={20} aria-hidden="true" />}
                    {key !== 'back' && key !== 'clear' && key}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
