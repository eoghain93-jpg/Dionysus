// Banked staff drinks ("one in for yourself").
//
// A credit is created server-side by the create_order_with_items RPC when a
// checkout includes a line flagged staff_credit_for — never from this module
// — so online and offline-synced sales bank credits identically. This module
// only reads the bank and redeems from it.
import { supabase } from './supabase'
import { getTillId } from './till'

// Active staff members for the "who is it for?" picker.
export async function fetchStaffMembers() {
  const { data, error } = await supabase
    .from('members')
    .select('id, name')
    .eq('membership_tier', 'staff')
    .eq('active', true)
    .order('name')
  if (error) throw error
  return data ?? []
}

// Oldest-first so redemption consumes the longest-banked drink.
export async function fetchBankedCredits(staff_member_id) {
  const { data, error } = await supabase
    .from('staff_drink_credits')
    // Explicit FK hint: the table has TWO links to products (what was
    // bought vs what was poured), so the embed must name which one.
    .select('id, amount, created_at, product_id, products!staff_drink_credits_product_id_fkey(name)')
    .eq('staff_member_id', staff_member_id)
    .eq('status', 'banked')
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

// Atomically marks the credit redeemed and writes the stock movement for
// whatever was actually poured (the redeem RPC guards against double
// redemption server-side). The credit owner comes from the credit row, so
// whoever is working can redeem for an off-shift colleague — redeemed_by
// records who poured it. Requires the till to be online.
export async function redeemCredit(credit_id, poured_product_id, redeemed_by) {
  const { error } = await supabase.rpc('redeem_staff_drink_credit', {
    p_credit_id: credit_id,
    p_product_id: poured_product_id,
    p_till_id: getTillId(),
    p_redeemed_by: redeemed_by ?? null,
  })
  if (error) throw error
}
