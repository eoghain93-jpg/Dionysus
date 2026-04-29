import { supabase } from './supabase'

export async function recordPrizeWin(amount, machine, staff_id, till_id = 'till-1') {
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
    .select('amount, machine')
    .gte('created_at', from)
    .lte('created_at', to)
  if (error) throw error
  const rows = data ?? []
  const sumOf = (m) => rows
    .filter(r => r.machine === m)
    .reduce((s, r) => s + Number(r.amount), 0)
  return {
    total: rows.reduce((s, r) => s + Number(r.amount), 0),
    machine1: sumOf('1'),
    machine2: sumOf('2'),
  }
}
