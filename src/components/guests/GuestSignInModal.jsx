import { useState, useEffect, useRef } from 'react'
import { X, Search, Plus } from '../../lib/icons'
import { searchMembersByName } from '../../lib/members'
import { signInGuests } from '../../lib/guests'
import { useSessionStore } from '../../stores/sessionStore'
import { useToastStore } from '../../hooks/useToast'

/**
 * GuestSignInModal — signs non-members in to the guest book.
 * Staff pick the member vouching for them, then enter each guest's name.
 * Pre-fills the member when one is already identified on the till.
 */
export default function GuestSignInModal({ initialMember = null, onClose, onSaved }) {
  const { activeStaff } = useSessionStore()
  const addToast = useToastStore(s => s.addToast)
  const [member, setMember] = useState(initialMember)
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [guests, setGuests] = useState([''])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const debounceRef = useRef(null)

  useEffect(() => {
    clearTimeout(debounceRef.current)
    if (member || query.trim().length < 2) { setSuggestions([]); return }
    debounceRef.current = setTimeout(() => {
      searchMembersByName(query.trim()).then(setSuggestions).catch(() => setSuggestions([]))
    }, 250)
    return () => clearTimeout(debounceRef.current)
  }, [query, member])

  function updateGuest(i, value) {
    setGuests(g => g.map((n, j) => (j === i ? value : n)))
  }

  function removeGuest(i) {
    setGuests(g => (g.length === 1 ? [''] : g.filter((_, j) => j !== i)))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!member) { setError('Select the member signing them in'); return }
    const names = guests.map(n => n.trim()).filter(Boolean)
    if (names.length === 0) { setError('Enter at least one guest name'); return }
    setSaving(true)
    setError(null)
    try {
      await signInGuests(names, member.id, activeStaff?.id)
      addToast(`${names.length} guest${names.length > 1 ? 's' : ''} signed in with ${member.name}`, 'success')
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
      <div className="bg-[#0F172A] border border-slate-700 rounded-2xl w-full max-w-sm p-5 flex flex-col gap-4 max-h-[90dvh] overflow-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-white font-bold text-lg">Sign In Guest</h2>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-white cursor-pointer">
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
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
                  onClick={() => { setMember(null); setQuery('') }}
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
                  onChange={e => setQuery(e.target.value)}
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

          <fieldset className="flex flex-col gap-2">
            <legend className="text-slate-300 text-sm mb-1">Guest name{guests.length > 1 ? 's' : ''}</legend>
            {guests.map((name, i) => (
              <div key={i} className="flex gap-2">
                <input
                  type="text"
                  value={name}
                  onChange={e => updateGuest(i, e.target.value)}
                  placeholder="Full name"
                  aria-label={`Guest ${i + 1} name`}
                  autoComplete="off"
                  autoFocus={!!member && i === guests.length - 1}
                  className="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {guests.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeGuest(i)}
                    aria-label={`Remove guest ${i + 1}`}
                    className="px-2 text-slate-400 hover:text-white cursor-pointer"
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() => setGuests(g => [...g, ''])}
              className="self-start flex items-center gap-1 text-blue-400 hover:text-blue-300 text-xs font-medium cursor-pointer min-h-[32px]"
            >
              <Plus size={14} aria-hidden="true" />
              Add another guest
            </button>
          </fieldset>

          {error && <p role="alert" className="text-red-400 text-sm">{error}</p>}
          <div className="flex gap-2 mt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 min-h-[44px] rounded-xl border border-slate-600 text-slate-300 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 min-h-[44px] rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold cursor-pointer transition-colors"
            >
              {saving ? 'Saving…' : 'Sign in'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
