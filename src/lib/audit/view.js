// Reading the audit log.
//
// The log lives in a private part of the database; the only way in is a
// handful of database functions (section 10 of the audit migration), each
// of which needs a staff member signed in at a till. These are thin
// wrappers over them for the Log page. Nothing here writes to the log
// except markAuditChecked (and the database itself notes that the log was
// opened).
//
// Every failure is thrown as an AuditViewError whose `kind` says what the
// page should tell the person looking:
//   not_available  the database update that adds the log has not landed yet
//   not_signed_in  no staff member is signed in as far as the server knows
//   not_allowed    this device is not a till (or its sign-in has lapsed)
//   offline        the request never reached the server
//   timeout        the server gave up before it had an answer
//   failed         anything else (retry)

import { supabase } from '../supabase'

export const AUDIT_ERROR = {
  NOT_AVAILABLE: 'not_available',
  NOT_SIGNED_IN: 'not_signed_in',
  NOT_ALLOWED: 'not_allowed',
  OFFLINE: 'offline',
  TIMEOUT: 'timeout',
  FAILED: 'failed',
}

const MESSAGES = {
  not_available: 'The log will be available once the database update has been applied',
  not_signed_in: 'Sign in with your PIN to see the log',
  not_allowed: 'The log can only be opened from a till',
  offline: 'Could not reach the server. Check the connection and try again.',
  timeout: 'The server took too long to answer. Try again, or look at fewer days at a time.',
  failed: 'Could not load the log',
}

// What "Check now" says when the check itself ran out of time. Nothing is
// wrong with the log: the nightly check has no time limit.
export const CHECK_TOOK_TOO_LONG = 'The check took too long to finish here; the nightly check still runs'

export class AuditViewError extends Error {
  constructor(kind, message, cause) {
    super(message || MESSAGES[kind] || MESSAGES.failed)
    this.name = 'AuditViewError'
    this.kind = kind
    if (cause !== undefined) this.cause = cause
  }
}

export function isAuditNotAvailable(error) {
  return error?.kind === AUDIT_ERROR.NOT_AVAILABLE
}

/** Turn whatever supabase-js handed back (or threw) into an AuditViewError. */
export function toAuditViewError(error) {
  if (error instanceof AuditViewError) return error
  const code = String(error?.code ?? '')
  const message = String(error?.message ?? error ?? '')
  const status = Number(error?.status ?? 0)

  if (code === 'PGRST202' || /could not find the function/i.test(message)) {
    return new AuditViewError(AUDIT_ERROR.NOT_AVAILABLE, null, error)
  }
  if (/sign in with your pin/i.test(message)) {
    return new AuditViewError(AUDIT_ERROR.NOT_SIGNED_IN, null, error)
  }
  if (code === '42501' || code === 'PGRST301' || status === 401 || status === 403 || /permission denied|jwt/i.test(message)) {
    return new AuditViewError(AUDIT_ERROR.NOT_ALLOWED, null, error)
  }
  // 57014: the database cancelled the statement at its time limit. A
  // gateway in front of it can give up first (504).
  if (code === '57014' || status === 504 || /statement timeout|upstream request timeout/i.test(message)) {
    return new AuditViewError(AUDIT_ERROR.TIMEOUT, null, error)
  }
  if (globalThis.navigator?.onLine === false || /failed to fetch|networkerror|network request failed|load failed/i.test(message)) {
    return new AuditViewError(AUDIT_ERROR.OFFLINE, null, error)
  }
  return new AuditViewError(AUDIT_ERROR.FAILED, message || null, error)
}

async function call(fn, args) {
  let result
  try {
    result = await (args === undefined ? supabase.rpc(fn) : supabase.rpc(fn, args))
  } catch (error) {
    throw toAuditViewError(error)
  }
  if (result?.error) throw toAuditViewError(result.error)
  return result?.data ?? null
}

function clean(filter) {
  const out = {}
  for (const [key, value] of Object.entries(filter ?? {})) {
    if (value === null || value === undefined || value === '') continue
    if (Array.isArray(value) && value.length === 0) continue
    out[key] = value
  }
  return out
}

/**
 * Merge the pages of several filters into one newest-first page.
 *
 * Each filter was fetched with the same before_seq and limit. A filter that
 * hit its limit may have more entries just below the last one it returned,
 * so nothing older than the newest such cut-off can be shown yet — it is
 * fetched again on the next page, where every filter starts from that
 * cut-off.
 */
export function mergeAuditPages(pages) {
  const bySeq = new Map()
  let cutoff = null
  for (const page of pages) {
    for (const entry of page?.entries ?? []) {
      if (entry && !bySeq.has(entry.seq)) bySeq.set(entry.seq, entry)
    }
    const next = page?.next_before_seq
    if (next !== null && next !== undefined && (cutoff === null || Number(next) > Number(cutoff))) cutoff = next
  }
  let entries = [...bySeq.values()].sort((a, b) => Number(b.seq) - Number(a.seq))
  if (cutoff !== null) entries = entries.filter(e => Number(e.seq) >= Number(cutoff))
  return { entries, next_before_seq: cutoff }
}

/**
 * Does the entry mention this text? The same idea as the database's own
 * search — the entry's name, list and stored values, the NAME of the
 * product or member it is about and of the staff member who did it — for a
 * filter that cannot pass the search box to the database (see `local_q`
 * below). It must never be narrower than the database's search, or the two
 * would disagree about what "Guinness" finds.
 */
export function entryContains(entry, text) {
  const needle = String(text ?? '').trim().toLowerCase()
  if (!needle) return true
  const haystack = [
    entry?.action, entry?.table, entry?.subject, entry?.staff_name,
    JSON.stringify(entry?.old ?? ''), JSON.stringify(entry?.new ?? ''), JSON.stringify(entry?.detail ?? ''),
  ].join(' ').toLowerCase()
  return haystack.includes(needle)
}

/**
 * One page of the log, newest first.
 *
 * @param {object | object[]} filters  an audit_view filter, or several whose
 *        results are merged (a quick view such as "Sales and voids" is rows
 *        from some tables PLUS till reports with certain names, which one
 *        filter cannot express)
 *        A filter may carry `local_q`: text that is matched here, on the
 *        results, instead of being sent — only for a filter whose own `q`
 *        is already taken (no quick view has one today: views pick entries
 *        by flag, changed column or who made the change, which the
 *        database matches exactly and which leave `q` free for the search
 *        box).
 * @param {{ beforeSeq?: number, limit?: number }} [page]
 * @returns {Promise<{ entries: object[], next_before_seq: number | null }>}
 */
export async function fetchAuditEntries(filters, { beforeSeq, limit } = {}) {
  const list = (Array.isArray(filters) ? filters : [filters]).map(f => clean({
    ...f,
    ...(beforeSeq !== null && beforeSeq !== undefined ? { before_seq: beforeSeq } : {}),
    ...(limit ? { limit } : {}),
  }))
  if (list.length === 0) list.push({})

  const one = async ({ local_q: localText, ...filter }) => {
    const data = await call('audit_view', { p_filter: filter })
    const entries = Array.isArray(data?.entries) ? data.entries : []
    return {
      entries: localText ? entries.filter(e => entryContains(e, localText)) : entries,
      next_before_seq: data?.next_before_seq ?? null,
    }
  }

  // The first filter goes alone: the database notes "log opened" at most
  // once every five minutes, and several simultaneous first requests would
  // each write that note.
  const first = await one(list[0])
  if (list.length === 1) return first
  const rest = await Promise.all(list.slice(1).map(one))
  return mergeAuditPages([first, ...rest])
}

/** Is everything being recorded, sealed and intact? */
export async function fetchAuditHealth() {
  return call('audit_health')
}

/** Who was signed in, where and when. Defaults to the last seven days. */
export async function fetchAuditSessions(from = null, to = null) {
  const data = await call('audit_sessions', { p_from: from ?? null, p_to: to ?? null })
  return Array.isArray(data) ? data : []
}

/**
 * Seal whatever is outstanding and re-check the log, now.
 *
 * The result's `scope` says how much was re-read: 'everything', or 'recent'
 * (the chain of every seal, but only the entries of the last 30 days — what
 * the database does once the log is large; the nightly check covers the
 * rest). An older database does not say.
 *
 * Throws kind 'timeout' (with a message that says the nightly check still
 * runs) when the database ran out of time.
 */
export async function verifyAuditNow() {
  let data
  try {
    data = await call('audit_verify_now')
  } catch (error) {
    if (error?.kind === AUDIT_ERROR.TIMEOUT) throw new AuditViewError(AUDIT_ERROR.TIMEOUT, CHECK_TOOK_TOO_LONG, error.cause)
    throw error
  }
  if (!data || typeof data !== 'object') throw new AuditViewError(AUDIT_ERROR.FAILED, 'The check did not return a result')
  return { ...data, problems: Array.isArray(data.problems) ? data.problems : [] }
}

/** Mark an alert as looked at. Resolves true; throws when it could not be marked. */
export async function markAuditChecked(seq, note) {
  const text = typeof note === 'string' ? note.trim() : ''
  const ok = await call('audit_ack', { p_seq: seq, p_note: text ? text.slice(0, 500) : null })
  if (ok !== true) throw new AuditViewError(AUDIT_ERROR.FAILED, 'That entry could not be marked as checked')
  return true
}

/**
 * Names for the ids that appear in the log, so entries can say "Guinness"
 * and "Sam Staff" instead of an id. Best effort: anything that cannot be
 * read is simply left out and the page falls back to "a product".
 *
 * @returns {Promise<{ names: Record<string, string>, staff: { id: string, name: string }[] }>}
 */
export async function fetchAuditNames() {
  const read = async (table, columns) => {
    try {
      const { data, error } = await supabase.from(table).select(columns)
      return error || !Array.isArray(data) ? [] : data
    } catch {
      return []
    }
  }
  const [products, members, promotions] = await Promise.all([
    read('products', 'id, name'),
    read('members', 'id, name, membership_tier'),
    read('promotions', 'id, name'),
  ])
  const names = {}
  for (const row of [...products, ...members, ...promotions]) {
    if (row?.id && row.name) names[row.id] = row.name
  }
  const staff = members
    .filter(m => m?.id && m.name && m.membership_tier === 'staff')
    .map(m => ({ id: m.id, name: m.name }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return { names, staff }
}
