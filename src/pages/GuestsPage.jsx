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
    <div className="flex flex-col h-full min-h-0 p-4 gap-4 overflow-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-bold text-white">Guests</h1>
        <div className="flex items-center gap-3 flex-wrap">
          <input
            type="date"
            value={date}
            onChange={e => changeDate(e.target.value)}
            max={tradingTodayISO()}
            aria-label="Select guest book date"
            className="bg-[#0F172A] border border-slate-700 rounded-xl px-3 min-h-[44px] text-white text-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
          />
          <button
            onClick={() => setShowSignIn(true)}
            className="flex items-center gap-2 px-4 min-h-[44px] rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
          >
            <UserPlus size={16} aria-hidden="true" />
            Sign in guest
          </button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-red-400 text-sm">{error}</p>
      ) : loading ? (
        <div className="text-slate-400 text-sm">Loading…</div>
      ) : guests.length === 0 ? (
        <div className="text-slate-400 text-sm">No guests signed in on {date}</div>
      ) : (
        <div className="bg-[#0F172A] border border-slate-700 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-700 text-slate-400 text-sm">
            {guests.length} guest{guests.length > 1 ? 's' : ''}
          </div>
          <ul className="divide-y divide-slate-800">
            {guests.map(g => (
              <li key={g.id} className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-white text-sm font-medium truncate">{g.guest_name}</div>
                  <div className="text-slate-400 text-xs truncate">
                    Guest of {g.member?.name ?? 'unknown member'}
                    {g.member?.membership_number && ` (${g.member.membership_number})`}
                  </div>
                </div>
                <div className="text-slate-400 text-xs shrink-0">
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
