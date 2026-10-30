import { supabase } from './supabase'
import { getTillId } from './till'
import { tradingDayRange } from './tradingDay'

/**
 * Signs one or more non-members in as guests of a member. Blank names are
 * dropped; one guest_signins row is written per guest.
 */
export async function signInGuests(guestNames, member_id, staff_id, till_id = getTillId()) {
  const names = guestNames.map(n => n.trim()).filter(Boolean)
  if (names.length === 0) throw new Error('Enter at least one guest name')
  if (!member_id) throw new Error('Select the member signing them in')
  const rows = names.map(guest_name => ({ guest_name, member_id, staff_id, till_id }))
  const { error } = await supabase.from('guest_signins').insert(rows)
  if (error) throw error
}

/** Guest book entries for a trading day (YYYY-MM-DD), oldest first. */
export async function fetchGuestsForDate(date) {
  const { from, to } = tradingDayRange(date)
  const { data, error } = await supabase
    .from('guest_signins')
    .select('id, guest_name, created_at, member:members!guest_signins_member_id_fkey(name, membership_number)')
    .gte('created_at', from)
    .lt('created_at', to)
    .order('created_at')
  if (error) throw error
  return data ?? []
}
