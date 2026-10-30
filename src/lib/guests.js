import { supabase } from './supabase'
import { getTillId } from './till'
import { tradingDayRange } from './tradingDay'
import { fetchAllPages } from './fetchAllPages'

// Enforced server-side by sign_in_guests
// (supabase/migrations/20261030200000_guest_records_fee_and_limit.sql) —
// keep these in sync with it.
export const GUEST_FEE = 2
export const GUEST_VISIT_LIMIT = 3

/** Matches the guests.name_key generated column. */
export function guestNameKey(name) {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Visits in the rolling 12 months up to `now`, from a list of sign-in timestamps. */
export function visitsInLastYear(signinTimes, now = new Date()) {
  const cutoff = new Date(now)
  cutoff.setFullYear(cutoff.getFullYear() - 1)
  return signinTimes.filter(t => new Date(t) > cutoff).length
}

/**
 * How many visits a guest (name + date of birth) has used in the last 12
 * months. 0 for someone who has never been signed in.
 */
export async function fetchGuestVisits(name, date_of_birth) {
  const { data, error } = await supabase
    .from('guests')
    .select('id, guest_signins(created_at)')
    .eq('name_key', guestNameKey(name))
    .eq('date_of_birth', date_of_birth)
    .maybeSingle()
  if (error) throw error
  return visitsInLastYear((data?.guest_signins ?? []).map(s => s.created_at))
}

/**
 * Signs guests in under a member and charges the member the guest fee
 * (GUEST_FEE per guest) by cash or card, in one atomic RPC. Throws with
 * the server's message if any guest is over the visit limit — in which
 * case nobody is signed in and nothing is charged.
 *
 * guests: [{ name, date_of_birth: 'YYYY-MM-DD' }]
 */
export async function signInGuests(guests, member_id, payment_method, staff_id, till_id = getTillId()) {
  const party = guests
    .map(g => ({ name: g.name.trim(), date_of_birth: g.date_of_birth }))
    .filter(g => g.name)
  if (party.length === 0) throw new Error('Enter at least one guest name')
  if (party.some(g => !g.date_of_birth)) throw new Error('Enter a date of birth for every guest')
  if (!member_id) throw new Error('Select the member signing them in')
  const { data, error } = await supabase.rpc('sign_in_guests', {
    p_member_id: member_id,
    p_guests: party,
    p_payment_method: payment_method,
    p_staff_id: staff_id ?? null,
    p_till_id: till_id,
  })
  if (error) throw error
  return data
}

/** Guest book entries for a trading day (YYYY-MM-DD), oldest first. */
export async function fetchGuestsForDate(date) {
  const { from, to } = tradingDayRange(date)
  const { data, error } = await supabase
    .from('guest_signins')
    .select('id, guest_name, created_at, fee, guest:guests(date_of_birth), member:members!guest_signins_member_id_fkey(name, membership_number)')
    .gte('created_at', from)
    .lt('created_at', to)
    .order('created_at')
  if (error) throw error
  return data ?? []
}

/**
 * Every guest record with their visit count in the last 12 months and
 * their most recent visit, sorted by name.
 */
export async function fetchGuestRecords(now = new Date()) {
  const rows = await fetchAllPages(() => supabase
    .from('guests')
    .select('id, name, date_of_birth, guest_signins(created_at, member:members!guest_signins_member_id_fkey(name))'))
  return rows
    .map(g => {
      const signins = [...(g.guest_signins ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at))
      return {
        id: g.id,
        name: g.name,
        date_of_birth: g.date_of_birth,
        visitsThisYear: visitsInLastYear(signins.map(s => s.created_at), now),
        totalVisits: signins.length,
        lastVisit: signins[0]?.created_at ?? null,
        lastSignedInBy: signins[0]?.member?.name ?? null,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}
