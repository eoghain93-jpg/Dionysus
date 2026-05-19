import { supabase } from './supabase'
import { getTillId } from './till'

export async function recordPrizeWin(amount, machine, staff_id, till_id = getTillId()) {
  const { error } = await supabase
    .from('prize_wins')
    .insert({ amount, machine, staff_id, till_id })
  if (error) throw error
}

/**
 * Returns total + per-machine breakdown for a given YYYY-MM-DD.
 * Z-report uses the per-machine numbers so the supplier can be reimbursed
 * for each machine individually.
 */
export async function fetchPrizeWinsForDate(date) {
  const from = `${date}T00:00:00`
  const to   = `${date}T23:59:59`
  const { data, error } = await supabase
    .from('prize_wins')
    .select('amount, machine, till_id')
    .gte('created_at', from)
    .lte('created_at', to)
  if (error) throw error
  const rows = data ?? []
  const sumOf = (m) => rows
    .filter(r => r.machine === m)
    .reduce((s, r) => s + Number(r.amount), 0)
  // Per-till breakdown for Z reconciliation. Defaults both tills to 0.
  const byTill = { 'till-1': 0, 'till-2': 0 }
  rows.forEach(r => {
    const t = r.till_id || 'till-1'
    byTill[t] = (byTill[t] ?? 0) + Number(r.amount)
  })
  return {
    total: rows.reduce((s, r) => s + Number(r.amount), 0),
    machine1: sumOf('1'),
    machine2: sumOf('2'),
    byTill,
  }
}
