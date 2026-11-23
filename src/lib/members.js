import { supabase } from './supabase'
import { db } from './db'
import { useSyncStore } from '../stores/syncStore'
import { getTillId } from './till'

// PostgREST's answer when no function with those argument names exists.
function isMissingFunction(error) {
  return !!error && (error.code === 'PGRST202' || /could not find the function/i.test(error.message ?? ''))
}

// Every members column EXCEPT pin_hash. The till never needs a staff PIN
// hash (PINs are checked by the server), and anything it fetches is kept by
// the browser's offline cache, so the hash is simply never asked for.
// A new members column the till should see must be added here.
export const MEMBER_COLUMNS = 'id, name, membership_number, phone, email, membership_tier, tab_balance, renewal_date, '
  + 'favourite_drinks, notes, active, created_at, auth_user_id, last_settled_at, tab_blocked, tab_blocked_at, tab_blocked_by'

// Postgres / PostgREST's answer when a named column does not exist.
function isMissingColumn(error) {
  return !!error && (error.code === '42703' || error.code === 'PGRST204' || /column .* does not exist/i.test(error.message ?? ''))
}

/**
 * Run a members query asking for MEMBER_COLUMNS. `build(columns)` returns
 * the query. Against a database that has not had a listed column added yet
 * (the app can deploy before a migration lands) it is asked again for '*',
 * and withoutPinHash drops the hash from what comes back.
 */
export async function selectMembers(build) {
  const result = await build(MEMBER_COLUMNS)
  return isMissingColumn(result?.error) ? build('*') : result
}

// Belt and braces for the '*' fallback above and for rows cached by older
// versions: a PIN hash is dropped before a row is cached or handed to the
// app — it must not sit in the till's local database for anyone to copy.
function withoutPinHash(row) {
  if (!row || typeof row !== 'object' || !('pin_hash' in row)) return row
  const { pin_hash, ...rest } = row
  return { ...rest, has_pin: pin_hash != null }
}

/**
 * One-off tidy-up at start-up: remove PIN hashes that earlier versions of
 * the till cached locally. Never throws.
 */
export async function scrubCachedPinHashes() {
  try {
    await db.members.toCollection().modify(row => { delete row.pin_hash })
  } catch { /* no local cache, or it cannot be opened: nothing to scrub */ }
  // The offline cache of server answers (service worker, 'supabase-cache')
  // kept whole members responses, hashes included, under earlier versions.
  try {
    if (typeof caches === 'undefined') return
    const cache = await caches.open('supabase-cache')
    const requests = await cache.keys()
    await Promise.all(requests
      .filter(request => request.url.includes('/rest/v1/members'))
      .map(request => cache.delete(request)))
  } catch { /* no Cache API, or it is unavailable: nothing to clear */ }
}

export async function fetchMembers() {
  const { isOnline } = useSyncStore.getState()

  if (isOnline) {
    const { data, error } = await selectMembers(columns => supabase
      .from('members')
      .select(columns)
      .eq('active', true)
      .order('name'))
    if (error) throw error
    const members = (data ?? []).map(withoutPinHash)
    await db.members.bulkPut(members)
    return members
  } else {
    return db.members.where('active').equals(1).sortBy('name')
  }
}

export async function searchMembersByName(name) {
  // When online, always go to Supabase so tab_balance is fresh. IndexedDB
  // is only an offline fallback — caching tab_balance leads to stale
  // figures in the basket after settlements / new tab orders.
  const { isOnline } = useSyncStore.getState()
  if (isOnline) {
    const { data } = await selectMembers(columns => supabase
      .from('members')
      .select(columns)
      .eq('active', true)
      .ilike('name', `%${name}%`)
      .order('name')
      .limit(8))
    const rows = (data ?? []).map(withoutPinHash)
    if (rows.length) await db.members.bulkPut(rows)
    return rows
  }
  const lower = name.toLowerCase()
  return db.members.filter(m => m.active && m.name.toLowerCase().includes(lower)).toArray()
}

export async function findMemberByNumber(membership_number) {
  // Online: always fetch from Supabase so tab_balance reflects reality.
  // Cache is only used as an offline fallback.
  const { isOnline } = useSyncStore.getState()
  if (isOnline) {
    const { data, error } = await selectMembers(columns => supabase
      .from('members')
      .select(columns)
      .eq('membership_number', membership_number)
      .single())
    if (error) return null
    await db.members.put(withoutPinHash(data))
    return withoutPinHash(data)
  }
  return await db.members.where('membership_number').equals(membership_number).first()
}

export async function upsertMember(member) {
  const { id, ...fields } = member
  if (id) {
    // Note: whenever a member's email is added OR changed, the wallet pass
    // fires from the database trigger wallet_pass_on_email_add (migrations
    // 20260508120000 + 20260513210000). That guarantees the send happens
    // regardless of which client made the change — till, dashboard, raw SQL
    // — and isn't gated on a freshly deployed JS bundle.
    const { data, error } = await selectMembers(columns =>
      supabase.from('members').update(fields).eq('id', id).select(columns).single())
    if (error) throw error
    await db.members.put(withoutPinHash(data))
    return withoutPinHash(data)
  } else {
    if (!fields.membership_number) {
      // Use max(M####) + 1, not count + 1 — count is unreliable once any
      // member has been deleted or staff (STF-***) numbers exist.
      const { data: rows } = await supabase
        .from('members')
        .select('membership_number')
        .like('membership_number', 'M%')
      const maxN = (rows ?? []).reduce((m, r) => {
        const n = Number(String(r.membership_number).slice(1))
        return Number.isFinite(n) && n > m ? n : m
      }, 0)
      fields.membership_number = `M${String(maxN + 1).padStart(4, '0')}`
    }
    // Not through selectMembers: a retry would insert the member twice.
    const { data: inserted, error } = await supabase.from('members').insert(fields).select().single()
    if (error) throw error
    const data = withoutPinHash(inserted)
    await db.members.put(data)
    if (data.email) {
      // Fire-and-forget: send the magic-link login email AND the wallet
      // pass email. Both run in parallel; failure of either doesn't block
      // member creation. Member receives two separate emails — one to log
      // into the member-app, one with the .pkpass + Google Wallet button.
      supabase.functions.invoke('invite-member', {
        body: { member_id: data.id, email: data.email },
      }).then(({ error }) => {
        if (error) console.error('Failed to send member invite:', error)
      })
      supabase.functions.invoke('send-wallet-pass-email', {
        body: { member_id: data.id },
      }).then(({ error }) => {
        if (error) console.error('Failed to send wallet pass email:', error)
      })
    }
    return data
  }
}

export async function settleTab(member_id, amount, payment_method, staff_id) {
  // One atomic RPC: balance decrement (clamped at zero), last_settled_at
  // stamp on a FULL settlement only, and the settlement order insert. The
  // order is flagged as a tab settlement and remembers the previous
  // last_settled_at, so a mistaken settle can be undone from Recent Sales.
  const args = {
    p_member_id: member_id,
    p_amount: amount,
    p_payment_method: payment_method,
    p_till_id: getTillId(),
  }
  // Who took the payment — stamped on the settlement order.
  let { data, error } = await supabase.rpc('settle_tab', { ...args, p_staff_id: staff_id ?? null })
  // This bundle can reach a till before the database update has landed (or
  // while the API is still reloading its schema): the old settle_tab has no
  // p_staff_id. "Function not found" means nothing ran, so it is safe to
  // ask again the old way — a customer must not be left unable to pay.
  // ONLY for that error: after a timeout or a dropped connection the first
  // call may have gone through, and a retry would take the payment twice.
  if (isMissingFunction(error)) {
    ({ data, error } = await supabase.rpc('settle_tab', args))
  }
  if (error) throw error
  return Number(data)
}
