import { supabase } from './supabase'

export async function logWastage(product_id, quantity, till_id = 'till-1') {
  const { error } = await supabase
    .from('stock_movements')
    .insert({ product_id, quantity, type: 'wastage', till_id })
  if (error) throw error
}

export async function logStaffDrink(product_id, quantity, member_id, till_id = 'till-1') {
  const { error } = await supabase
    .from('stock_movements')
    .insert({ product_id, quantity, type: 'staff_drink', member_id, till_id })
  if (error) throw error
}

export async function fetchWastageForDate(date) {
  const from = `${date}T00:00:00`
  const to = `${date}T23:59:59`
  const { data, error } = await supabase
    .from('stock_movements')
    .select('product_id, quantity, products(name, standard_price)')
    .eq('type', 'wastage')
    .gte('created_at', from)
    .lte('created_at', to)
  if (error) throw error
  // Consolidate multiple wastage rows for the same product into one line
  const byProduct = {}
  ;(data ?? []).forEach(r => {
    const key = r.product_id ?? r.products?.name ?? 'unknown'
    const name = r.products?.name ?? 'Unknown'
    const price = r.products?.standard_price ?? 0
    if (!byProduct[key]) byProduct[key] = { name, quantity: 0, value: 0 }
    byProduct[key].quantity += r.quantity
    byProduct[key].value    += r.quantity * price
  })
  return Object.values(byProduct).sort((a, b) => b.value - a.value)
}

export async function fetchStaffDrinksForDate(date) {
  const from = `${date}T00:00:00`
  const to = `${date}T23:59:59`
  const { data, error } = await supabase
    .from('stock_movements')
    .select('quantity, member_id, products(name, standard_price), members(name)')
    .eq('type', 'staff_drink')
    .gte('created_at', from)
    .lte('created_at', to)
  if (error) throw error
  const byMember = {}
  ;(data ?? []).forEach(r => {
    const key = r.member_id ?? 'unknown'
    const memberName = r.members?.name ?? 'Unknown'
    const value = r.quantity * (r.products?.standard_price ?? 0)
    if (!byMember[key]) byMember[key] = { name: memberName, items: 0, value: 0 }
    byMember[key].items += r.quantity
    byMember[key].value += value
  })
  return Object.values(byMember)
}
