import { useState, useEffect } from 'react'
import { UserPlus, Search } from '../lib/icons'
import { fetchGuestsForDate, fetchGuestRecords, GUEST_VISIT_LIMIT } from '../lib/guests'
import { tradingTodayISO } from '../lib/tradingDay'
import GuestSignInModal from '../components/guests/GuestSignInModal'

const formatDate = iso => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

/**
 * GuestsPage — the guest book (who was signed in on a trading day) and the
 * guest records (every guest, matched by name + date of birth, with their
 * visits against the yearly limit). Staff can sign new guests in from here.
 */
export default function GuestsPage() {
  const [view, setView] = useState('book')
  const [showSignIn, setShowSignIn] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  return (
    <div className="flex flex-col h-full min-h-0 p-4 gap-4 overflow-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-bold text-white">Guests</h1>
        <button
          onClick={() => setShowSignIn(true)}
          className="flex items-center gap-2 px-4 min-h-[44px] rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
        >
          <UserPlus size={16} aria-hidden="true" />
          Sign in guest
        </button>
      </div>

      <div role="tablist" className="flex gap-2">
        {[['book', 'Guest book'], ['records', 'Guest records']].map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={view === key}
            onClick={() => setView(key)}
            className={`px-4 min-h-[40px] rounded-xl text-sm font-medium cursor-pointer transition-colors ${
              view === key
                ? 'bg-slate-700 text-white'
                : 'bg-slate-900 text-slate-400 hover:bg-slate-800 hover:text-white border border-slate-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {view === 'book'
        ? <GuestBook refreshKey={refreshKey} />
        : <GuestRecords refreshKey={refreshKey} />}

      {showSignIn && (
        <GuestSignInModal
          onClose={() => setShowSignIn(false)}
          onSaved={() => { setShowSignIn(false); setRefreshKey(k => k + 1) }}
        />
      )}
    </div>
  )
}

function GuestBook({ refreshKey }) {
  const [date, setDate] = useState(tradingTodayISO())
  const [guests, setGuests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

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

  const feesTotal = guests.reduce((s, g) => s + Number(g.fee ?? 0), 0)

  return (
    <section className="flex flex-col gap-3">
      <input
        type="date"
        value={date}
        onChange={e => changeDate(e.target.value)}
        max={tradingTodayISO()}
        aria-label="Select guest book date"
        className="self-start bg-[#0F172A] border border-slate-700 rounded-xl px-3 min-h-[44px] text-white text-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
      />
      {error ? (
        <p role="alert" className="text-red-400 text-sm">{error}</p>
      ) : loading ? (
        <div className="text-slate-400 text-sm">Loading…</div>
      ) : guests.length === 0 ? (
        <div className="text-slate-400 text-sm">No guests signed in on {date}</div>
      ) : (
        <div className="bg-[#0F172A] border border-slate-700 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-700 text-slate-400 text-sm flex justify-between">
            <span>{guests.length} guest{guests.length > 1 ? 's' : ''}</span>
            <span>Fees £{feesTotal.toFixed(2)}</span>
          </div>
          <ul className="divide-y divide-slate-800">
            {guests.map(g => (
              <li key={g.id} className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-white text-sm font-medium truncate">
                    {g.guest_name}
                    {g.guest?.date_of_birth && (
                      <span className="text-slate-500 font-normal ml-2">b. {formatDate(g.guest.date_of_birth)}</span>
                    )}
                  </div>
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
    </section>
  )
}

function GuestRecords({ refreshKey }) {
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let cancelled = false
    fetchGuestRecords()
      .then(rows => { if (!cancelled) { setRecords(rows); setError(null) } })
      .catch(err => { if (!cancelled) setError(err.message ?? 'Failed to load guest records') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [refreshKey])

  const q = query.trim().toLowerCase()
  const shown = q ? records.filter(r => r.name.toLowerCase().includes(q)) : records

  return (
    <section className="flex flex-col gap-3">
      <div className="relative max-w-sm">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search guests"
          aria-label="Search guests"
          className="w-full bg-[#0F172A] border border-slate-700 rounded-xl pl-9 pr-3 min-h-[44px] text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <p className="text-slate-500 text-xs">
        Guests can visit {GUEST_VISIT_LIMIT} times in any 12 months, then they need to join as a member.
      </p>
      {error ? (
        <p role="alert" className="text-red-400 text-sm">{error}</p>
      ) : loading ? (
        <div className="text-slate-400 text-sm">Loading…</div>
      ) : shown.length === 0 ? (
        <div className="text-slate-400 text-sm">{q ? 'No guests match your search' : 'No guest records yet'}</div>
      ) : (
        <div className="bg-[#0F172A] border border-slate-700 rounded-2xl overflow-hidden">
          <ul className="divide-y divide-slate-800">
            {shown.map(r => {
              const full = r.visitsThisYear >= GUEST_VISIT_LIMIT
              return (
                <li key={r.id} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-white text-sm font-medium truncate">
                      {r.name}
                      <span className="text-slate-500 font-normal ml-2">b. {formatDate(r.date_of_birth)}</span>
                    </div>
                    <div className="text-slate-400 text-xs truncate">
                      {r.lastVisit
                        ? `Last visit ${formatDate(r.lastVisit)}${r.lastSignedInBy ? ` with ${r.lastSignedInBy}` : ''}`
                        : 'No visits'}
                      {r.totalVisits > r.visitsThisYear && ` · ${r.totalVisits} visits in total`}
                    </div>
                  </div>
                  <span
                    className={`shrink-0 text-xs font-semibold border rounded-lg px-2 py-1 ${
                      full
                        ? 'bg-red-900/40 border-red-700/60 text-red-300'
                        : 'bg-slate-800 border-slate-700 text-slate-300'
                    }`}
                  >
                    {full ? 'Must join' : `${r.visitsThisYear} of ${GUEST_VISIT_LIMIT} visits`}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </section>
  )
}
