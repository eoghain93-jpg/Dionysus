import { supabase } from './supabase'

export async function recordCashback(amount, staff_id, till_id = 'till-1') {
  const { error } = await supabase
    .from('cashback_transactions')
    .insert({ amount, staff_id, till_id })
  if (error) throw error
}

export async function fetchCashbackForDate(date) {
  const from = `${date}T00:00:00`
  const to   = `${date}T23:59:59`
  const { data, error } = await supabase
    .from('cashback_transactions')
    .select('amount')
    .gte('created_at', from)
    .lte('created_at', to)
  if (error) throw error
  return (data ?? []).reduce((sum, r) => sum + Number(r.amount), 0)
}
