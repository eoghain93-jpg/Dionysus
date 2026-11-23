import { useState } from 'react'
import { formatDateTime, formatTime, tillLabel, TRUST_LABELS } from '../../lib/audit/describe'

const END_WORDS = {
  sign_out: 'signed out',
  switch_user: 'switched to someone else',
  idle_lock: 'till locked itself',
  manual_lock: 'till was locked',
  unused_unlock: 'PIN accepted too late to unlock the till',
  close_day: 'day was closed',
  replaced: 'someone else signed in',
}

const SHOW_FIRST = 8
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString()

// "4 h 30 min" — a shift length wants more than the nearest hour.
function lasted(session) {
  if (!session.ended_at) return null
  const ms = new Date(session.ended_at).getTime() - new Date(session.started_at).getTime()
  if (!Number.isFinite(ms) || ms < 0) return null
  const minutes = Math.round(ms / 60000)
  if (minutes < 60) return `${minutes} min`
  const rest = minutes % 60
  return `${Math.floor(minutes / 60)} h${rest ? ` ${rest} min` : ''}`
}

/**
 * SessionsPanel — who was signed in, on which till, from when to when.
 * Shown above the entries in the "Sign-ins" view.
 *
 * Props: sessions (audit_sessions() rows, newest first), loading, error
 */
export default function SessionsPanel({ sessions, loading, error }) {
  const [showAll, setShowAll] = useState(false)
  const list = sessions ?? []
  const shown = showAll ? list : list.slice(0, SHOW_FIRST)

  return (
    <section aria-label="Who was signed in" className="bg-[#0F172A] rounded-2xl border border-slate-700 p-4 flex flex-col gap-3">
      <h2 className="text-white font-semibold">Who was signed in</h2>
      {loading && <p className="text-slate-400 text-sm">Loading sign-ins…</p>}
      {!loading && error && <p role="alert" className="text-amber-300 text-sm">Could not load who was signed in: {error}</p>}
      {!loading && !error && list.length === 0 && <p className="text-slate-500 text-sm">Nobody was signed in during these dates.</p>}
      {!loading && !error && list.length > 0 && (
        <ul className="flex flex-col gap-2">
          {shown.map(s => {
            const length = lasted(s)
            return (
              <li key={s.id} className="rounded-xl bg-slate-800/60 px-3 py-2 text-sm flex flex-col gap-0.5">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-white font-medium">{s.staff_name ?? 'A staff member no longer on the list'}</span>
                  <span className="text-slate-400">· {tillLabel(s.till_id) ?? 'unknown till'}</span>
                  <span className={`border rounded-md px-1.5 py-0.5 text-xs ${s.trust === 'pin' ? 'bg-emerald-900/50 text-emerald-200 border-emerald-700/50' : 'bg-amber-900/50 text-amber-200 border-amber-700/50'}`}>
                    {TRUST_LABELS[s.trust] ?? 'not confirmed'}
                  </span>
                </div>
                <p className="text-slate-300 break-words">
                  {formatDateTime(s.started_at)}
                  {' to '}
                  {s.ended_at
                    ? (sameDay(s.started_at, s.ended_at) ? formatTime(s.ended_at) : formatDateTime(s.ended_at))
                    : <span className="text-emerald-300 font-medium">still signed in</span>}
                  {length && <span className="text-slate-500"> ({length})</span>}
                  {s.ended_at && s.end_reason && (
                    <span className="text-slate-500"> — {END_WORDS[s.end_reason] ?? s.end_reason.replace(/_/g, ' ')}</span>
                  )}
                </p>
                {s.ip && <p className="text-slate-500 text-xs break-all">Network address {s.ip}</p>}
              </li>
            )
          })}
        </ul>
      )}
      {!loading && !error && list.length > SHOW_FIRST && (
        <button
          onClick={() => setShowAll(v => !v)}
          className="self-start min-h-[44px] px-4 rounded-xl border border-slate-600 text-slate-200 hover:bg-slate-700 text-sm font-medium cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {showAll ? 'Show fewer' : `Show all ${list.length}`}
        </button>
      )}
    </section>
  )
}
