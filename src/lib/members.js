import { supabase } from './supabase'
import { db } from './db'
import { useSyncStore } from '../stores/syncStore'

export async function fetchMembers() {
  const { isOnline } = useSyncStore.getState()

  if (isOnline) {
    const { data, error } = await supabase
      .from('members')
      .select('*')
      .eq('active', true)
      .order('name')
    if (error) throw error
    await db.members.bulkPut(data)
    return data
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
    const { data } = await supabase
      .from('members')
      .select('*')
      .eq('active', true)
      .ilike('name', `%${name}%`)
      .order('name')
      .limit(8)
    if (data?.length) await db.members.bulkPut(data)
    return data ?? []
  }
  const lower = name.toLowerCase()
  return db.members.filter(m => m.active && m.name.toLowerCase().includes(lower)).toArray()
}

export async function findMemberByNumber(membership_number) {
  // Online: always fetch from Supabase so tab_balance reflects reality.
  // Cache is only used as an offline fallback.
  const { isOnline } = useSyncStore.getState()
  if (isOnline) {
    const { data, error } = await supabase
      .from('members')
      .select('*')
      .eq('membership_number', membership_number)
      .single()
    if (error) return null
    await db.members.put(data)
    return data
  }
  return await db.members.where('membership_number').equals(membership_number).first()
}

export async function upsertMember(member) {
  const { id, ...fields } = member
  if (id) {
    // Note: when an email is added to a previously-emailless member, the
    // wallet pass + invite emails fire from the database trigger
    // wallet_pass_on_email_add (migration 20260508120000). That guarantees
    // the send happens regardless of which client made the change — till,
    // dashboard, raw SQL — and isn't gated on a freshly deployed JS bundle.
    const { data, error } = await supabase.from('members').update(fields).eq('id', id).select().single()
    if (error) throw error
    await db.members.put(data)
    return data
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
    const { data, error } = await supabase.from('members').insert(fields).select().single()
    if (error) throw error
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

export async function addToTabBalance(member_id, amount) {
  const { data: member, error: fetchError } = await supabase
    .from('members')
    .select('tab_balance')
    .eq('id', member_id)
    .single()
  if (fetchError) throw fetchError
  // Number() guard: tab_balance can come back as a string from some
  // Supabase / Postgres configs; without it `+` would string-concat.
  const newBalance = Number(member?.tab_balance ?? 0) + Number(amount)
  const { error } = await supabase
    .from('members')
    .update({ tab_balance: newBalance })
    .eq('id', member_id)
  if (error) throw error
}

export async function settleTab(member_id, amount, payment_method) {
  // Re-fetch current balance to avoid stale-read overwrite
  const { data: member, error: fetchError } = await supabase
    .from('members')
    .select('tab_balance')
    .eq('id', member_id)
    .single()
  if (fetchError) throw fetchError

  const newBalance = Math.max(0, Number(member.tab_balance) - amount)

  // Only stamp last_settled_at on a FULL settlement (balance hits zero).
  // Partial settlements leave the tab open with previous orders still on
  // it, so we must keep the line items visible in the Tabs view.
  const updateFields = { tab_balance: newBalance }
  if (newBalance === 0) {
    updateFields.last_settled_at = new Date().toISOString()
  }
  const { error } = await supabase
    .from('members')
    .update(updateFields)
    .eq('id', member_id)
  if (error) throw error

  await supabase.from('orders').insert({
    member_id,
    payment_method,
    total_amount: amount,
    status: 'paid',
    till_id: 'till-1',
  })
}
