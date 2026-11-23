// What the health strip says, worked out from audit_health().
//
// Kept apart from the component so the rules ("what counts as something
// wrong") can be read and tested on their own. Two levels:
//   bad   the log cannot be trusted or is not recording — must be seen
//   warn  worth knowing, not an emergency

import { coverageLines, duration, formatBytes, formatDateTime, formatTime } from '../../lib/audit/describe'

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

// The database seals new entries every five minutes; well past that means
// the sealing job is not running.
const SEALING_LATE_AFTER = 30 * MINUTE
// The self-check runs once a night.
const CHECK_LATE_AFTER = 36 * HOUR

function ms(value) {
  if (!value) return null
  const t = new Date(value).getTime()
  return Number.isNaN(t) ? null : t
}

function sameDay(a, b) {
  const x = new Date(a)
  const y = new Date(b)
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate()
}

/** "just now", "5 minutes ago", "3 hours ago" */
export function timeAgo(value, now) {
  const t = ms(value)
  if (t === null) return ''
  const gap = now - t
  if (gap < 90 * 1000) return 'just now'
  return `${duration(gap / 1000)} ago`
}

/** "14:02 (5 minutes ago)", or with the day when it was not today. */
export function whenText(value, now) {
  const t = ms(value)
  if (t === null) return 'never'
  const clock = sameDay(t, now) ? formatTime(value) : formatDateTime(value)
  return `${clock} (${timeAgo(value, now)})`
}

const number = n => Number(n ?? 0).toLocaleString('en-GB')

/**
 * @param {object} health  the audit_health() result
 * @param {{ now: number, remembered?: { id, code, hash } | null }} opts
 *        remembered: the newest seal this till has itself been shown
 * @returns {{ level: 'bad' | 'warn', text: string }[]}
 */
export function healthIssues(health, { now, remembered = null } = {}) {
  if (!health) return []
  const issues = []
  const bad = text => issues.push({ level: 'bad', text })
  const warn = text => issues.push({ level: 'warn', text })
  const settings = health.settings ?? {}

  if (settings.capture_enabled === false) {
    bad('Recording is switched OFF. Changes to the books are not being logged.')
  }
  if (health.last_check?.result === 'integrity.FAILED') {
    bad(`The last check FAILED: ${whenText(health.last_check.at, now)}. The log may have been tampered with — press “Check now” for the details.`)
  }
  // What is not recorded, and which protections are gone, switched off or
  // pointed at other code. (An older database lists less; nothing listed
  // means nothing to say.)
  for (const line of coverageLines(health.coverage)) bad(`${line}.`)
  // Only an explicit "no": an older database does not say either way.
  if (health.code_unchanged === false) {
    bad('The log’s own recording code has been changed since it was last accepted. That is expected only straight after a database update or upgrade — otherwise someone may have altered how things are recorded. Tell whoever looks after the system.')
  }

  if (remembered?.id && health.seal) {
    const same = Number(remembered.id) === Number(health.seal.id)
    if (same && remembered.hash && health.seal.hash && remembered.hash !== health.seal.hash) {
      bad(`This till was shown seal ${remembered.code ?? remembered.id}, but the database now holds a different seal with that number (${health.seal.code}). History may have been rewritten.`)
    } else if (Number(remembered.id) > Number(health.seal.id)) {
      bad(`This till has seen a newer seal (${remembered.code ?? remembered.id}) than the database now holds (${health.seal.code}). History may have been rewritten, or the database restored from a backup.`)
    }
  } else if (remembered?.id && !health.seal) {
    bad(`This till remembers seal ${remembered.code ?? remembered.id}, but the database now has no seals at all.`)
  }

  if (Number(health.capture_failures_7d) > 0) {
    const n = Number(health.capture_failures_7d)
    warn(`${number(n)} ${n === 1 ? 'change' : 'changes'} could not be recorded in the last 7 days.`)
  }
  if (settings.guards_enforced === false) {
    warn('Protection of past records is in watch-only mode: deleting or editing an old sale directly, or writing a PIN or tab balance straight into a member’s record, is noted but not stopped.')
  }
  const waitingSince = ms(health.oldest_unsealed_at)
  if (Number(health.unsealed) > 0 && waitingSince !== null && now - waitingSince > SEALING_LATE_AFTER) {
    const n = Number(health.unsealed)
    warn(`Sealing is behind: ${number(n)} ${n === 1 ? 'entry has' : 'entries have'} been waiting for a seal since ${whenText(health.oldest_unsealed_at, now)}.`)
  } else if (!health.seal && Number(health.entries) > 0 && waitingSince !== null && now - waitingSince > SEALING_LATE_AFTER) {
    warn('Nothing has been sealed yet.')
  }
  const checkedAt = ms(health.last_check?.at)
  if (health.last_check?.result !== 'integrity.FAILED' && checkedAt !== null && now - checkedAt > CHECK_LATE_AFTER) {
    warn(`The nightly check has not run since ${whenText(health.last_check.at, now)}.`)
  }
  return issues
}

/**
 * Seals this till once held that the database later no longer had (see
 * disputedSeals in lib/audit/seal.js), as lines for the strip. They stay
 * until the till's storage is cleared: the till is the only place that
 * still knows.
 * @returns {{ key: string, text: string }[]}
 */
export function disputedSealLines(disputed) {
  const list = Array.isArray(disputed) ? disputed : []
  return list
    .filter(d => d !== null && typeof d === 'object' && (d.code || d.id))
    .map((d, i) => ({
      key: `${d.id ?? ''}:${d.hash ?? ''}:${i}`,
      text: `Seal ${d.code ?? `number ${d.id}`}${ms(d.at) !== null ? `, made ${formatDateTime(d.at)}` : ''} — noticed missing ${ms(d.noticed_at) !== null ? formatDateTime(d.noticed_at) : 'at a time that was not kept'}`,
    }))
}

/** What "this till's own evidence" means, in one sentence. */
export const DISPUTED_MEANING = 'This till was shown each of these seals, and the database later no longer had it: the log’s history was changed underneath this till — rewritten, or restored from a backup.'

/**
 * What "Check now" found when it passed, in words — including how much of
 * the log it re-read. On a large log the database checks the chain of
 * every seal but re-reads only recent entries ('recent'); the nightly check
 * covers the rest. An older database does not say which it did.
 */
export function checkPassedText(result) {
  const r = result ?? {}
  const n = Number(r.rows_checked ?? 0)
  const entries = `${number(n)} ${n === 1 ? 'entry' : 'entries'}`
  const seal = r.head?.code ? ` Newest seal ${r.head.code}.` : ''
  if (r.scope === 'recent') {
    const since = ms(r.since) !== null ? ` recorded since ${formatDateTime(r.since)}` : ' from recent weeks'
    const seals = Number(r.seals_checked) > 0 ? `all ${number(r.seals_checked)} seals` : 'every seal'
    return `Checked just now: the chain of ${seals} is unbroken, and all ${entries}${since} ${n === 1 ? 'is' : 'are'} intact. Older entries were not re-read this time; the nightly check covers them.${seal}`
  }
  const whole = r.scope === 'everything' ? ' (the whole log)' : ''
  return `Checked just now: all ${entries} ${n === 1 ? 'is' : 'are'} intact and nothing has been altered${whole}.${seal}`
}

const CHECK_WORDS = {
  'integrity.ok': 'passed',
  'integrity.checked': 'passed',
  'integrity.FAILED': 'FAILED',
}

/** The quiet facts: [{ label, value }]. */
export function healthFacts(health, { now } = {}) {
  if (!health) return []
  const settings = health.settings ?? {}
  const facts = [
    { label: 'Recording', value: settings.capture_enabled === false ? 'OFF' : 'on' },
    { label: 'Last entry', value: health.last_entry_at ? whenText(health.last_entry_at, now) : 'none yet' },
    {
      label: 'Newest seal',
      value: health.seal ? `${health.seal.code} · ${whenText(health.seal.sealed_at, now)}` : 'none yet',
    },
    {
      label: 'Last check',
      value: health.last_check
        ? `${CHECK_WORDS[health.last_check.result] ?? 'done'} · ${whenText(health.last_check.at, now)}`
        : 'not run yet',
    },
    {
      label: 'Size',
      value: `${formatBytes(health.bytes)} · ${number(health.entries)} ${Number(health.entries) === 1 ? 'entry' : 'entries'} (${number(health.entries_24h)} in the last 24 hours)`,
    },
  ]
  return facts
}
