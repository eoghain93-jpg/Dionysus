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
      className="ui-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Sign In Guest"
    >
      <div className="ui-modal">
        <div className="flex items-center justify-between gap-3">
          <h2 className="ui-modal-title">Sign In Guest</h2>
          <button onClick={onClose} aria-label="Close" className="ui-btn ui-btn-ghost ui-btn-icon shrink-0">
            <X size={22} aria-hidden="true" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label htmlFor="guest-member" className="ui-label">Signed in by member</label>
            {member ? (
              <div className="flex items-center justify-between gap-3 bg-blue-950 border border-blue-600 rounded-xl pl-4 pr-1.5 min-h-[56px]">
                <span className="text-white text-base font-bold min-w-0 truncate">
                  {member.name}
                  <span className="text-blue-300 font-semibold ml-2">{member.membership_number}</span>
                </span>
                <button
                  type="button"
                  onClick={() => { setMember(null); setQuery('') }}
                  className="ui-btn ui-btn-ghost min-h-[44px] shrink-0"
                >
                  Change
                </button>
              </div>
            ) : (
              <div className="relative">
                <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" aria-hidden="true" />
                <input
                  id="guest-member"
                  type="text"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search member name"
                  autoComplete="off"
                  autoFocus
                  className="ui-input pl-12"
                />
                {suggestions.length > 0 && (
                  <ul className="absolute z-10 left-0 right-0 mt-1 bg-slate-800 border border-slate-700 rounded-xl overflow-hidden shadow-xl divide-y divide-slate-700">
                    {suggestions.map(m => (
                      <li key={m.id}>
                        <button
                          type="button"
                          onClick={() => setMember(m)}
                          className="w-full text-left px-4 min-h-[52px] text-base font-bold text-white hover:bg-slate-700 cursor-pointer"
                        >
                          {m.name}
                          <span className="text-slate-400 font-semibold ml-2">{m.membership_number}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="ui-label">Guest name{guests.length > 1 ? 's' : ''}</legend>
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
                  className="ui-input flex-1 min-w-0"
                />
                {guests.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeGuest(i)}
                    aria-label={`Remove guest ${i + 1}`}
                    className="ui-btn ui-btn-ghost ui-btn-icon shrink-0"
                  >
                    <X size={20} aria-hidden="true" />
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() => setGuests(g => [...g, ''])}
              className="ui-btn ui-btn-secondary self-start"
            >
              <Plus size={18} aria-hidden="true" />
              Add another guest
            </button>
          </fieldset>

          {error && <p role="alert" className="ui-banner ui-banner-bad">{error}</p>}
          <div className="ui-modal-actions">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="ui-btn ui-btn-ghost ui-btn-lg flex-1"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="ui-btn ui-btn-accent ui-btn-lg flex-1"
            >
              {saving ? 'Saving…' : 'Sign in'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
