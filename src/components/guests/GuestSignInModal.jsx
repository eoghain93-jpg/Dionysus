import { useState, useEffect, useRef } from 'react'
import { X, Search, Plus, Banknote, CreditCard } from '../../lib/icons'
import { searchMembersByName } from '../../lib/members'
import { signInGuests, fetchGuestVisits, guestNameKey, GUEST_FEE, GUEST_VISIT_LIMIT } from '../../lib/guests'
import { openDrawer } from '../../lib/starPrinter'
import { useSessionStore } from '../../stores/sessionStore'
import { useToastStore } from '../../hooks/useToast'

const EMPTY_GUEST = { name: '', date_of_birth: '' }

/**
 * GuestSignInModal — signs non-members in to the guest book.
 * Staff pick the member vouching for them and enter each guest's name and
 * date of birth. The member pays the guest fee per guest by cash or card
 * (never a tab). Guests over the visit limit are flagged as soon as their
 * details are entered, and the server refuses them regardless.
 * Pre-fills the member when one is already identified on the till.
 */
export default function GuestSignInModal({ initialMember = null, onClose, onSaved }) {
  const { activeStaff } = useSessionStore()
  const addToast = useToastStore(s => s.addToast)
  const [member, setMember] = useState(initialMember)
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [guests, setGuests] = useState([EMPTY_GUEST])
  // Visits used in the last 12 months, keyed by "name|dob"
  const [visits, setVisits] = useState({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const debounceRef = useRef(null)

  useEffect(() => {
    clearTimeout(debounceRef.current)
    if (member || query.trim().length < 2) return
    debounceRef.current = setTimeout(() => {
      searchMembersByName(query.trim()).then(setSuggestions).catch(() => setSuggestions([]))
    }, 250)
    return () => clearTimeout(debounceRef.current)
  }, [query, member])

  const visitKey = g => `${guestNameKey(g.name)}|${g.date_of_birth}`

  function checkVisits(g) {
    if (!g.name.trim() || !g.date_of_birth) return
    const key = visitKey(g)
    if (key in visits) return
    fetchGuestVisits(g.name, g.date_of_birth)
      .then(n => setVisits(v => ({ ...v, [key]: n })))
      .catch(() => {})
  }

  function updateGuest(i, field, value) {
    setGuests(gs => gs.map((g, j) => (j === i ? { ...g, [field]: value } : g)))
  }

  function removeGuest(i) {
    setGuests(gs => (gs.length === 1 ? [EMPTY_GUEST] : gs.filter((_, j) => j !== i)))
  }

  const party = guests.filter(g => g.name.trim())
  const fee = party.length * GUEST_FEE
  const overLimit = party.filter(g => (visits[visitKey(g)] ?? 0) >= GUEST_VISIT_LIMIT)

  async function handlePay(paymentMethod) {
    if (!member) { setError('Select the member signing them in'); return }
    if (party.length === 0) { setError('Enter at least one guest name'); return }
    if (party.some(g => !g.date_of_birth)) { setError('Enter a date of birth for every guest'); return }
    if (overLimit.length) {
      setError(`${overLimit[0].name.trim()} has used all ${GUEST_VISIT_LIMIT} guest visits this year — they need to join as a member`)
      return
    }
    setSaving(true)
    setError(null)
    try {
      await signInGuests(party, member.id, paymentMethod, activeStaff?.id)
      if (paymentMethod === 'cash') {
        try {
          await openDrawer()
        } catch {
          addToast('Drawer failed — use manual open in Settings', 'error')
        }
      }
      addToast(`${party.length} guest${party.length > 1 ? 's' : ''} signed in with ${member.name}`, 'success')
      onSaved()
    } catch (err) {
      setError(err.message ?? 'Failed to sign in guest')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Sign In Guest"
    >
      <div className="bg-[#0F172A] border border-slate-700 rounded-2xl w-full max-w-md p-5 flex flex-col gap-4 max-h-[90dvh] overflow-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-white font-bold text-lg">Sign In Guest</h2>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-white cursor-pointer">
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="guest-member" className="text-slate-300 text-sm">Signed in by member</label>
            {member ? (
              <div className="flex items-center justify-between bg-slate-800 border border-slate-600 rounded-lg px-3 py-2">
                <span className="text-white text-sm">
                  {member.name}
                  <span className="text-slate-400 ml-2">{member.membership_number}</span>
                </span>
                <button
                  type="button"
                  onClick={() => { setMember(null); setQuery(''); setSuggestions([]) }}
                  className="text-blue-400 hover:text-blue-300 text-xs font-medium cursor-pointer"
                >
                  Change
                </button>
              </div>
            ) : (
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden="true" />
                <input
                  id="guest-member"
                  type="text"
                  value={query}
                  onChange={e => { setQuery(e.target.value); if (e.target.value.trim().length < 2) setSuggestions([]) }}
                  placeholder="Search member name"
                  autoComplete="off"
                  autoFocus
                  className="w-full bg-slate-800 border border-slate-600 rounded-lg pl-9 pr-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {suggestions.length > 0 && (
                  <ul className="absolute z-10 left-0 right-0 mt-1 bg-slate-800 border border-slate-600 rounded-lg overflow-hidden shadow-xl">
                    {suggestions.map(m => (
                      <li key={m.id}>
                        <button
                          type="button"
                          onClick={() => setMember(m)}
                          className="w-full text-left px-3 py-2 min-h-[44px] text-sm text-white hover:bg-slate-700 cursor-pointer"
                        >
                          {m.name}
                          <span className="text-slate-400 ml-2">{m.membership_number}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <fieldset className="flex flex-col gap-3">
            <legend className="text-slate-300 text-sm mb-1">Guest{guests.length > 1 ? 's' : ''}</legend>
            {guests.map((g, i) => {
              const used = visits[visitKey(g)]
              return (
                <div key={i} className="flex flex-col gap-1">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={g.name}
                      onChange={e => updateGuest(i, 'name', e.target.value)}
                      onBlur={() => checkVisits(g)}
                      placeholder="Full name"
                      aria-label={`Guest ${i + 1} name`}
                      autoComplete="off"
                      autoFocus={!!member && i === guests.length - 1}
                      className="flex-1 min-w-0 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <input
                      type="date"
                      value={g.date_of_birth}
                      max={new Date().toISOString().slice(0, 10)}
                      onChange={e => updateGuest(i, 'date_of_birth', e.target.value)}
                      onBlur={() => checkVisits(g)}
                      aria-label={`Guest ${i + 1} date of birth`}
                      className="w-[9.5rem] bg-slate-800 border border-slate-600 rounded-lg px-2 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    {guests.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeGuest(i)}
                        aria-label={`Remove guest ${i + 1}`}
                        className="px-1 text-slate-400 hover:text-white cursor-pointer"
                      >
                        <X size={16} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                  {used !== undefined && (
                    used >= GUEST_VISIT_LIMIT ? (
                      <p className="text-red-400 text-xs">
                        All {GUEST_VISIT_LIMIT} guest visits used this year — must join as a member
                      </p>
                    ) : (
                      <p className="text-slate-400 text-xs">
                        {used === 0 ? 'First visit' : `Visit ${used + 1} of ${GUEST_VISIT_LIMIT} this year`}
                      </p>
                    )
                  )}
                </div>
              )
            })}
            <button
              type="button"
              onClick={() => setGuests(gs => [...gs, EMPTY_GUEST])}
              className="self-start flex items-center gap-1 text-blue-400 hover:text-blue-300 text-xs font-medium cursor-pointer min-h-[32px]"
            >
              <Plus size={14} aria-hidden="true" />
              Add another guest
            </button>
          </fieldset>

          <div className="flex items-center justify-between text-sm border-t border-slate-700 pt-3">
            <span className="text-slate-300">
              Guest fee{member ? ` — paid by ${member.name}` : ''}
            </span>
            <span className="text-white font-semibold tabular-nums">£{fee.toFixed(2)}</span>
          </div>

          {error && <p role="alert" className="text-red-400 text-sm">{error}</p>}
          <div className="flex gap-2 mt-1">
            <button
              type="button"
              onClick={() => handlePay('cash')}
              disabled={saving}
              className="flex-1 min-h-[44px] rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold cursor-pointer transition-colors flex items-center justify-center gap-2"
            >
              <Banknote size={16} aria-hidden="true" />
              Cash
            </button>
            <button
              type="button"
              onClick={() => handlePay('card')}
              disabled={saving}
              className="flex-1 min-h-[44px] rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold cursor-pointer transition-colors flex items-center justify-center gap-2"
            >
              <CreditCard size={16} aria-hidden="true" />
              Card
            </button>
          </div>
          {saving && <p className="text-slate-400 text-xs text-center">Signing in…</p>}
        </div>
      </div>
    </div>
  )
}
