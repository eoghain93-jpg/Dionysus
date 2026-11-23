import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { RefreshCw, Search, X } from 'lucide-react'
import {
  AUDIT_ERROR, fetchAuditEntries, fetchAuditHealth, fetchAuditNames, fetchAuditSessions,
  markAuditChecked, verifyAuditNow,
} from '../lib/audit/view'
import { combineSaleEntries, salesIndex, tableNoun, tillLabel, uncheckedSeqs } from '../lib/audit/describe'
import { rememberedSeal } from '../lib/audit/seal'
import { auditHeadersEnabled } from '../lib/audit/fetch'
import { getStaffSessionId } from '../lib/audit/staffSession'
import { getTillId } from '../lib/till'
import HealthStrip from '../components/audit/HealthStrip'
import AuditEntry from '../components/audit/AuditEntry'
import SessionsPanel from '../components/audit/SessionsPanel'
import {
  QUICK_VIEWS, DEFAULT_VIEW, PAGE_SIZE, buildFilters, defaultRange, findView, rangeToIso, recordFromParams,
} from '../components/audit/quickViews'

const FIELD = 'w-full min-w-0 bg-[#0F172A] border border-slate-700 rounded-xl px-3 py-2 text-white placeholder-slate-500 min-h-[44px] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]'
const BUTTON = 'min-h-[44px] px-4 rounded-xl border border-slate-600 text-slate-200 hover:bg-slate-700 hover:text-white text-sm font-medium transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617] disabled:opacity-60'

// Reasons the log cannot be shown at all (as opposed to "try again").
const BLOCKERS = {
  [AUDIT_ERROR.NOT_AVAILABLE]: {
    title: 'The log will be available once the database update has been applied',
    body: 'Nothing is wrong with the till — sales and everything else carry on as normal. Come back here after the update.',
  },
  [AUDIT_ERROR.NOT_SIGNED_IN]: {
    title: 'Sign in with your PIN to see the log',
    body: null, // depends on why the server does not know who is signed in — see signInHint
  },
  [AUDIT_ERROR.NOT_ALLOWED]: {
    title: 'This device is not allowed to open the log',
    body: 'The log can only be opened on a till that is signed in. If this is a till, sign the till in again and retry.',
  },
}

// The log records who looks at it, so the server has to recognise the
// person signed in at this till. Three reasons it might not:
function signInHint() {
  if (!auditHeadersEnabled()) {
    return 'The log records who looks at it, and this till has not yet finished setting up the link that tells the server who is signed in. It retries by itself every few seconds: check the connection, wait a moment, then press “Try again”.'
  }
  if (!getStaffSessionId()) {
    return 'The log records who looks at it, and your sign-in on this till is from before the log was switched on. Sign out, sign back in with your PIN, and open the Log again.'
  }
  return 'The log records who looks at it, and your PIN sign-in is too old for it (a sign-in lasts a day at most). Sign out, sign back in with your PIN, and open the Log again.'
}

const dayKey = value => {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? 'unknown' : d.toDateString()
}

function dayLabel(value, now) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return 'Date not known'
  const today = new Date(now)
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

function groupByDay(entries) {
  const groups = []
  for (const entry of entries) {
    const key = dayKey(entry.at)
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.entries.push(entry)
    else groups.push({ key, at: entry.at, entries: [entry] })
  }
  return groups
}

function addUnique(existing, more) {
  const seen = new Set(existing.map(e => e.seq))
  return [...existing, ...more.filter(e => !seen.has(e.seq))]
}

/**
 * AuditPage — the Log: where the owner reads what has been recorded.
 *
 * Top to bottom: is the log healthy; the alerts that need a look (the
 * default view); quick views by subject; filters; the entries themselves.
 * /log?table=products&pk=<id> opens the whole history of one record.
 *
 * Reading only — the one thing this page writes is "mark as checked".
 */
export default function AuditPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const record = useMemo(() => recordFromParams(searchParams), [searchParams])
  const top = useRef(null)

  const [viewId, setViewId] = useState(DEFAULT_VIEW)
  const [range, setRange] = useState(() => defaultRange())
  const [staffId, setStaffId] = useState('')
  const [tillId, setTillId] = useState('')
  const [searchBox, setSearchBox] = useState('')
  const [search, setSearch] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [now, setNow] = useState(() => Date.now())

  const view = findView(viewId)
  const filters = useMemo(
    () => buildFilters({ view, record, range, staffId, tillId, search }),
    [view, record, range, staffId, tillId, search],
  )
  const queryKey = `${JSON.stringify(filters)}#${refresh}`

  // ── Entries ──
  // Results are stored with the query they answer; "loading" is simply
  // "the stored results are for a different query".
  const [page, setPage] = useState({ key: null, entries: [], next: null, error: null })
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState(null)
  const loading = page.key !== queryKey

  useEffect(() => {
    let cancelled = false
    fetchAuditEntries(filters, { limit: PAGE_SIZE })
      .then(result => {
        if (cancelled) return
        setPage({ key: queryKey, entries: result.entries ?? [], next: result.next_before_seq ?? null, error: null })
        setMoreError(null)
        setNow(Date.now())
      })
      .catch(error => {
        if (!cancelled) setPage({ key: queryKey, entries: [], next: null, error })
      })
    return () => { cancelled = true }
  }, [filters, queryKey])

  // ── Health ──
  const [healthRefresh, setHealthRefresh] = useState(0)
  const healthKey = `${refresh}#${healthRefresh}`
  const [healthState, setHealthState] = useState({ key: null, data: null, error: null })
  const [check, setCheck] = useState({ running: false, result: null, error: null })

  useEffect(() => {
    let cancelled = false
    fetchAuditHealth()
      .then(data => {
        if (cancelled) return
        setHealthState({ key: healthKey, data, error: null })
        setNow(Date.now())
      })
      .catch(error => {
        if (!cancelled) setHealthState({ key: healthKey, data: null, error })
      })
    return () => { cancelled = true }
  }, [healthKey])

  // ── Names for ids, and who has been signed in lately (for the pickers) ──
  const [lookup, setLookup] = useState({ names: {}, staff: [] })
  const [recentSessions, setRecentSessions] = useState([])

  useEffect(() => {
    let cancelled = false
    fetchAuditNames()
      .then(result => { if (!cancelled && result) setLookup({ names: result.names ?? {}, staff: result.staff ?? [] }) })
      .catch(() => {})
    fetchAuditSessions()
      .then(list => { if (!cancelled && Array.isArray(list)) setRecentSessions(list) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // ── Who was signed in (Sign-ins view) ──
  const iso = rangeToIso(range)
  const showSessions = !!view.sessions && !record
  const sessionsKey = showSessions ? `${iso.from}|${iso.to}|${refresh}` : null
  const [sessionsState, setSessionsState] = useState({ key: null, list: [], error: null })

  useEffect(() => {
    if (!sessionsKey) return undefined
    let cancelled = false
    fetchAuditSessions(iso.from, iso.to)
      .then(list => { if (!cancelled) setSessionsState({ key: sessionsKey, list: Array.isArray(list) ? list : [], error: null }) })
      .catch(error => { if (!cancelled) setSessionsState({ key: sessionsKey, list: [], error }) })
    return () => { cancelled = true }
  }, [sessionsKey, iso.from, iso.to])

  // ── What is on screen ──
  const entries = page.entries
  const shown = useMemo(() => combineSaleEntries(entries), [entries])
  const ctx = useMemo(() => ({ names: lookup.names, sales: salesIndex(entries) }), [lookup.names, entries])
  const groups = useMemo(() => groupByDay(shown), [shown])

  const staffOptions = useMemo(() => {
    const byId = new Map(lookup.staff.map(s => [s.id, s.name]))
    for (const s of [...recentSessions, ...sessionsState.list]) {
      if (s?.staff_id && s.staff_name && !byId.has(s.staff_id)) byId.set(s.staff_id, s.staff_name)
    }
    for (const e of entries) {
      if (e?.staff_id && e.staff_name && !byId.has(e.staff_id)) byId.set(e.staff_id, e.staff_name)
    }
    return [...byId].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [lookup.staff, recentSessions, sessionsState.list, entries])

  const tillOptions = useMemo(() => {
    const ids = new Set([getTillId()])
    for (const s of [...recentSessions, ...sessionsState.list]) if (s?.till_id) ids.add(s.till_id)
    for (const e of entries) if (e?.till_id) ids.add(e.till_id)
    if (tillId) ids.add(tillId)
    return [...ids].filter(Boolean).sort()
  }, [recentSessions, sessionsState.list, entries, tillId])

  const sessionsShown = useMemo(
    () => sessionsState.list.filter(s => (!staffId || s.staff_id === staffId) && (!tillId || s.till_id === tillId)),
    [sessionsState.list, staffId, tillId],
  )

  const blockerKind = [healthState.error, loading ? null : page.error]
    .map(e => e?.kind)
    .find(kind => BLOCKERS[kind])
  const blocker = blockerKind ? BLOCKERS[blockerKind] : null

  // ── Actions ──
  function reload() {
    setRefresh(n => n + 1)
  }

  function chooseView(id) {
    setViewId(id)
    top.current?.scrollTo?.({ top: 0 })
  }

  function submitSearch(e) {
    e.preventDefault()
    setSearch(searchBox.trim())
  }

  function changeSearchBox(value) {
    setSearchBox(value)
    // Emptying the box (or its built-in clear button) clears the search.
    if (value.trim() === '' && search !== '') setSearch('')
  }

  const openRecord = useCallback((table, pk) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.set('table', table)
      next.set('pk', pk)
      return next
    })
    top.current?.scrollTo?.({ top: 0 })
  }, [setSearchParams])

  function closeRecord() {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.delete('table')
      next.delete('pk')
      return next
    })
  }

  async function loadMore() {
    if (page.next === null || loadingMore || loading) return
    const key = queryKey
    setLoadingMore(true)
    setMoreError(null)
    try {
      const result = await fetchAuditEntries(filters, { beforeSeq: page.next, limit: PAGE_SIZE })
      setPage(prev => (prev.key !== key
        ? prev
        : { ...prev, entries: addUnique(prev.entries, result.entries ?? []), next: result.next_before_seq ?? null }))
    } catch (err) {
      setMoreError(err?.message ?? 'Could not load more')
    } finally {
      setLoadingMore(false)
    }
  }

  async function runCheck() {
    setCheck({ running: true, result: null, error: null })
    try {
      const result = await verifyAuditNow()
      setCheck({ running: false, result, error: null })
    } catch (err) {
      setCheck({ running: false, result: null, error: err?.message ?? 'Something went wrong' })
    }
    // The check seals what was outstanding and records itself.
    setHealthRefresh(n => n + 1)
  }

  // Rejects when an entry could not be marked; the entry shows the message.
  // In "Needs a look" a checked alert leaves the list; elsewhere it stays
  // and shows as checked.
  const leavesWhenChecked = !record && view.filters.some(f => f.unchecked)
  const ack = useCallback(async (entry, note) => {
    const seqs = uncheckedSeqs(entry)
    const done = []
    const leaves = leavesWhenChecked
    try {
      for (const seq of seqs) {
        await markAuditChecked(seq, note)
        done.push(seq)
      }
    } finally {
      if (done.length) {
        setPage(prev => ({
          ...prev,
          entries: leaves
            ? prev.entries.filter(e => !done.includes(e.seq))
            : prev.entries.map(e => (done.includes(e.seq) ? { ...e, checked: true } : e)),
        }))
        setHealthState(prev => (prev.data
          ? { ...prev, data: { ...prev.data, unchecked_alerts: Math.max(0, Number(prev.data.unchecked_alerts ?? 0) - done.length) } }
          : prev))
      }
    }
  }, [leavesWhenChecked])

  const recordName = record
    ? (entries.find(e => e.subject)?.subject ?? lookup.names[record.pk] ?? null)
    : null

  return (
    <div ref={top} className="flex flex-col h-full min-h-0 p-4 gap-4 overflow-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-bold text-white">Log</h1>
        <button onClick={reload} className={`flex items-center gap-2 ${BUTTON}`}>
          <RefreshCw size={16} aria-hidden="true" />
          Refresh
        </button>
      </div>

      {blocker ? (
        <div role="alert" className="bg-[#0F172A] rounded-2xl border border-slate-700 p-6 flex flex-col gap-3 items-start">
          <h2 className="text-white text-lg font-semibold">{blocker.title}</h2>
          <p className="text-slate-400 text-sm">{blocker.body ?? signInHint()}</p>
          <button onClick={reload} className={BUTTON}>Try again</button>
        </div>
      ) : (
        <>
          <HealthStrip
            health={healthState.data}
            loading={healthState.key !== healthKey}
            error={healthState.error?.message ?? null}
            onRetry={() => setHealthRefresh(n => n + 1)}
            now={now}
            remembered={rememberedSeal()}
            check={check}
            onCheck={runCheck}
            onShowAlerts={() => { if (record) closeRecord(); chooseView('attention') }}
          />

          {record ? (
            <div className="rounded-2xl border border-blue-500/60 bg-blue-950/30 p-4 flex items-center gap-3 flex-wrap">
              <p className="text-white font-medium flex-1 min-w-[12rem] break-words">
                Everything recorded about {recordName ? `${tableNoun(record.table)} ${recordName}` : `this ${tableNoun(record.table)}`}
              </p>
              <button onClick={closeRecord} className={`flex items-center gap-2 ${BUTTON}`}>
                <X size={16} aria-hidden="true" />
                Back to the whole log
              </button>
            </div>
          ) : (
            <>
              {/* Quick views: a picker on a phone, buttons on anything wider */}
              <label className="md:hidden flex flex-col gap-1 text-slate-400 text-xs">
                Show
                <select value={view.id} onChange={e => chooseView(e.target.value)} className={`${FIELD} cursor-pointer text-base`}>
                  {QUICK_VIEWS.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
                </select>
              </label>
              <div role="group" aria-label="Quick views" className="hidden md:flex flex-wrap gap-2">
                {QUICK_VIEWS.map(v => (
                  <button
                    key={v.id}
                    onClick={() => chooseView(v.id)}
                    aria-pressed={v.id === view.id}
                    className={`min-h-[44px] px-4 rounded-xl text-sm font-semibold transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617] ${
                      v.id === view.id
                        ? 'bg-blue-600 text-white'
                        : 'bg-[#0F172A] border border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-white'
                    }`}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
              <p className="text-slate-500 text-sm -mt-2">{view.hint}</p>
            </>
          )}

          {/* Filters */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {!record && !view.allDates && (
              <>
                <label className="flex flex-col gap-1 text-slate-400 text-xs min-w-0">
                  From
                  <input
                    type="date"
                    value={range.from}
                    max={range.to || undefined}
                    onChange={e => setRange(r => ({ ...r, from: e.target.value }))}
                    className={FIELD}
                  />
                </label>
                <label className="flex flex-col gap-1 text-slate-400 text-xs min-w-0">
                  To
                  <input
                    type="date"
                    value={range.to}
                    min={range.from || undefined}
                    onChange={e => setRange(r => ({ ...r, to: e.target.value }))}
                    className={FIELD}
                  />
                </label>
              </>
            )}
            <label className="flex flex-col gap-1 text-slate-400 text-xs min-w-0">
              Staff member
              <select value={staffId} onChange={e => setStaffId(e.target.value)} className={`${FIELD} cursor-pointer`}>
                <option value="">Anyone</option>
                {staffOptions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-slate-400 text-xs min-w-0">
              Till
              <select value={tillId} onChange={e => setTillId(e.target.value)} className={`${FIELD} cursor-pointer`}>
                <option value="">Any till</option>
                {tillOptions.map(id => <option key={id} value={id}>{tillLabel(id)}</option>)}
              </select>
            </label>
          </div>

          <form onSubmit={submitSearch} role="search" className="flex gap-2">
            <div className="relative flex-1 min-w-0">
              <Search size={16} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                type="search"
                value={searchBox}
                onChange={e => changeSearchBox(e.target.value)}
                placeholder="Search the log…"
                aria-label="Search the log"
                className={`${FIELD} pl-9`}
              />
            </div>
            <button type="submit" className={BUTTON}>Search</button>
          </form>

          {showSessions && (
            <SessionsPanel
              sessions={sessionsShown}
              loading={sessionsState.key !== sessionsKey}
              error={sessionsState.error?.message ?? null}
            />
          )}

          {/* Entries */}
          <div className="flex flex-col gap-4">
            {loading && <p className="text-slate-400 text-sm p-6 text-center">Loading the log…</p>}

            {!loading && page.error && (
              <div role="alert" className="bg-[#0F172A] rounded-2xl border border-slate-700 p-6 flex flex-col gap-3 items-start">
                <p className="text-red-300 font-medium">Could not load the log</p>
                <p className="text-slate-400 text-sm break-words">{page.error.message ?? 'Something went wrong.'}</p>
                <button onClick={reload} className={BUTTON}>Try again</button>
              </div>
            )}

            {!loading && !page.error && shown.length === 0 && (
              <div className="bg-[#0F172A] rounded-2xl border border-slate-700 p-8 text-center">
                <p className="text-slate-300 font-medium">Nothing here</p>
                <p className="text-slate-500 text-sm mt-1">
                  {record
                    ? 'Nothing has been recorded about this yet.'
                    : view.allDates && !search && !staffId && !tillId
                      ? 'No alerts are waiting to be checked.'
                      : 'Nothing matches these dates and filters.'}
                </p>
              </div>
            )}

            {!loading && !page.error && groups.map(group => (
              <section key={group.key} aria-label={dayLabel(group.at, now)} className="flex flex-col gap-2">
                <h2 className="text-slate-400 text-sm font-semibold">{dayLabel(group.at, now)}</h2>
                <ul className="flex flex-col gap-2">
                  {group.entries.map(entry => (
                    <AuditEntry key={entry.seq} entry={entry} ctx={ctx} onAck={ack} onOpenRecord={openRecord} />
                  ))}
                </ul>
              </section>
            ))}

            {!loading && !page.error && page.next !== null && (
              <div className="flex flex-col items-center gap-2">
                {moreError && <p role="alert" className="text-red-300 text-sm">Could not load more: {moreError}</p>}
                <button onClick={loadMore} disabled={loadingMore} className={BUTTON}>
                  {loadingMore ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}

            {!loading && !page.error && (
              <p className="text-slate-600 text-xs text-center">Opening this page is itself recorded in the log.</p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
