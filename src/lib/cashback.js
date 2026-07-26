import { supabase } from './supabase'
import { getTillId } from './till'
import { tradingDayRange } from './tradingDay'

export async function recordCashback(amount, staff_id, till_id = getTillId()) {
  const { error } = await supabase
    .from('cashback_transactions')
    .insert({ amount, staff_id, till_id })
  if (error) throw error
}

export async function fetchCashbackForDate(date) {
  const { from, to } = tradingDayRange(date)
  const { data, error } = await supabase
    .from('cashback_transactions')
    .select('amount, till_id')
    .gte('created_at', from)
    .lt('created_at', to)
  if (error) throw error
  return (data ?? []).reduce((sum, r) => sum + Number(r.amount), 0)
}

// Per-till breakdown — used by the Z report for per-till variance.
// Defaults each till to 0 even if no cashback was given on that till.
export async function fetchCashbackByTillForDate(date) {
  const { from, to } = tradingDayRange(date)
  const { data, error } = await supabase
    .from('cashback_transactions')
    .select('amount, till_id')
    .gte('created_at', from)
    .lt('created_at', to)
  if (error) throw error
  const byTill = { 'till-1': 0, 'till-2': 0 }
  ;(data ?? []).forEach(r => {
    const t = r.till_id || 'till-1'
    byTill[t] = (byTill[t] ?? 0) + Number(r.amount)
  })
  return byTill
}
