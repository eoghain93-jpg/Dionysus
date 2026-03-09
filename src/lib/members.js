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

export async function findMemberByNumber(membership_number) {
  const local = await db.members.where('membership_number').equals(membership_number).first()
  if (local) return local

  const { data, error } = await supabase
    .from('members')
    .select('*')
    .eq('membership_number', membership_number)
    .single()
  if (error) return null
  await db.members.put(data)
  return data
}

export async function upsertMember(member) {
  const { id, ...fields } = member
  if (id) {
    const { data, error } = await supabase.from('members').update(fields).eq('id', id).select().single()
    if (error) throw error
    await db.members.put(data)
    return data
  } else {
    if (!fields.membership_number) {
      const { count } = await supabase.from('members').select('id', { count: 'exact', head: true })
      fields.membership_number = `M${String((count || 0) + 1).padStart(4, '0')}`
    }
    const { data, error } = await supabase.from('members').insert(fields).select().single()
    if (error) throw error
    await db.members.put(data)
    return data
  }
}

export async function settleTab(member_id, amount, payment_method) {
  const { error } = await supabase
    .from('members')
    .update({ tab_balance: 0 })
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
