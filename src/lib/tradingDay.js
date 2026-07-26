// Trading day: the club's reporting day, running 06:00 UTC to 06:00 UTC
// the next morning.
//
// Big match nights (World Cup) run past midnight — orders rung up at 1am
// belong to the night that started them, not the next calendar day. The
// club never trades between 6am and 11am, so a 06:00 UTC cutoff cleanly
// splits sessions year-round: 6am UK in winter, 7am UK in summer, both
// hours the doors are shut. Using UTC (not Europe/London) keeps these
// strings directly comparable to timestamptz columns in PostgREST range
// filters and makes the maths DST-proof.
//
// Everything that reports "a day" — Z report, daily summary, monthly
// report, Fix Payment list — should derive its window from this module so
// the numbers always tie up.
//
// Keep in sync with the Deno copy in
// supabase/functions/send-monthly-report/report.ts.

export const TRADING_DAY_CUTOFF_HOURS = 6

const pad = n => String(n).padStart(2, '0')

/** Add n days to a YYYY-MM-DD string. */
export function addDaysISO(dateISO, n) {
  const d = new Date(`${dateISO}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// A date-time string with no zone designator ('2026-07-06T01:00:00')
// parses as LOCAL time in JS but as UTC in PostgREST — normalise to UTC
// so browser and server agree. Date-only strings already parse as UTC.
const NAIVE_DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/

/**
 * The trading day (YYYY-MM-DD) a timestamp belongs to: its UTC date, or
 * the previous date for timestamps before the 06:00 cutoff.
 */
export function tradingDayOf(timestamp) {
  const input = typeof timestamp === 'string' && NAIVE_DATETIME.test(timestamp)
    ? `${timestamp}Z`
    : timestamp
  const d = new Date(input)
  if (Number.isNaN(d.getTime())) return String(timestamp).slice(0, 10)
  d.setUTCHours(d.getUTCHours() - TRADING_DAY_CUTOFF_HOURS)
  return d.toISOString().slice(0, 10)
}

/** Today's trading day — yesterday's date until 06:00 UTC. */
export function tradingTodayISO(now = new Date()) {
  return tradingDayOf(now)
}

/**
 * created_at bounds for one trading day. `to` is EXCLUSIVE — pair
 * `.gte('created_at', from)` with `.lt('created_at', to)`.
 */
export function tradingDayRange(dateISO) {
  const cutoff = `T${pad(TRADING_DAY_CUTOFF_HOURS)}:00:00`
  return {
    from: `${dateISO}${cutoff}`,
    to: `${addDaysISO(dateISO, 1)}${cutoff}`,
  }
}

/**
 * created_at bounds spanning trading days startISO..endISO inclusive.
 * `to` is EXCLUSIVE, as in tradingDayRange.
 */
export function tradingRange(startISO, endISO) {
  return {
    from: tradingDayRange(startISO).from,
    to: tradingDayRange(endISO).to,
  }
}
