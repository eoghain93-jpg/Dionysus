import { useState, useEffect } from 'react'
import { UserPlus } from '../lib/icons'
import { fetchGuestsForDate } from '../lib/guests'
import { tradingTodayISO } from '../lib/tradingDay'
import GuestSignInModal from '../components/guests/GuestSignInModal'

/**
 * GuestsPage — the guest book. Lists non-members signed in on a trading
 * day, with who signed them in, and lets staff sign new guests in.
 */
export default function GuestsPage() {
  const [date, setDate] = useState(tradingTodayISO())
  const [guests, setGuests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showSignIn, setShowSignIn] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    fetchGuestsForDate(date)
      .then(rows => { if (!cancelled) { setGuests(rows); setError(null) } })
      .catch(err => { if (!cancelled) setError(err.message ?? 'Failed to load guests') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [date, refreshKey])

  function changeDate(value) {
    setLoading(true)
    setDate(value)
  }

  return (
    <div className="ui-page">
      <div className="ui-page-header">
        <h1 className="ui-title">Guests</h1>
        <div className="flex items-center gap-3 flex-wrap">
          <input
            type="date"
            value={date}
            onChange={e => changeDate(e.target.value)}
            max={tradingTodayISO()}
            aria-label="Select guest book date"
            className="ui-input w-auto flex-1 sm:flex-none cursor-pointer [color-scheme:dark]"
          />
          <button
            onClick={() => setShowSignIn(true)}
            className="ui-btn ui-btn-primary flex-1 sm:flex-none"
          >
            <UserPlus size={20} aria-hidden="true" />
            Sign in guest
          </button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="ui-banner ui-banner-bad">{error}</p>
      ) : loading ? (
        <div className="ui-card ui-empty">Loading…</div>
      ) : guests.length === 0 ? (
        <div className="ui-card ui-empty px-4">No guests signed in on {date}</div>
      ) : (
        <div className="ui-card overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 text-slate-300 text-[15px] font-bold">
            {guests.length} guest{guests.length > 1 ? 's' : ''}
          </div>
          <ul>
            {guests.map(g => (
              <li key={g.id} className="ui-row justify-between py-3">
                <div className="min-w-0">
                  <div className="text-white text-lg font-extrabold leading-tight truncate">{g.guest_name}</div>
                  <div className="text-slate-400 text-[15px] truncate">
                    Guest of {g.member?.name ?? 'unknown member'}
                    {g.member?.membership_number && ` (${g.member.membership_number})`}
                  </div>
                </div>
                <div className="text-slate-300 text-[15px] font-bold tabular-nums shrink-0">
                  {new Date(g.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {showSignIn && (
        <GuestSignInModal
          onClose={() => setShowSignIn(false)}
          onSaved={() => { setShowSignIn(false); setRefreshKey(k => k + 1) }}
        />
      )}
    </div>
  )
}
