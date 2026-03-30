// src/lib/promotions.js
import { supabase } from './supabase'

export async function fetchAllPromotions() {
  const { data, error } = await supabase
    .from('promotions')
    .select('*, promotion_items(*), promotion_categories(*)')
    .order('name')

  if (error) throw error
  return data ?? []
}

export async function fetchActivePromotions() {
  const { data, error } = await supabase
    .from('promotions')
    .select('*, promotion_items(*), promotion_categories(*)')
    .eq('active', true)
    .order('name')

  if (error) throw error
  return data ?? []
}

export async function upsertPromotion(promotion) {
  const { id, promotion_items, promotion_categories, ...fields } = promotion
  if (id) {
    const { data, error } = await supabase
      .from('promotions')
      .update(fields)
      .eq('id', id)
      .select('*, promotion_items(*), promotion_categories(*)')
      .single()
    if (error) throw error
    return data
  } else {
    const { data, error } = await supabase
      .from('promotions')
      .insert(fields)
      .select('*, promotion_items(*), promotion_categories(*)')
      .single()
    if (error) throw error
    return data
  }
}

export async function setPromotionActive(id, active) {
  const { data, error } = await supabase
    .from('promotions')
    .update({ active })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deletePromotion(id) {
  const { error } = await supabase
    .from('promotions')
    .delete()
    .eq('id', id)
  if (error) throw error
}

export async function replacePromotionItems(promotion_id, items) {
  // Delete all existing items then re-insert. Not atomic: if insert fails, items are lost.
  const { error: delError } = await supabase
    .from('promotion_items')
    .delete()
    .eq('promotion_id', promotion_id)
  if (delError) throw delError

  if (items.length === 0) return []

  const rows = items.map(item => ({ ...item, promotion_id }))
  const { data, error } = await supabase
    .from('promotion_items')
    .insert(rows)
    .select()
  if (error) throw error
  return data
}

export async function replacePromotionCategories(promotion_id, categories) {
  // Delete all existing categories then re-insert. Not atomic: if insert fails, categories are lost.
  const { error: delError } = await supabase
    .from('promotion_categories')
    .delete()
    .eq('promotion_id', promotion_id)
  if (delError) throw delError

  if (categories.length === 0) return []

  const rows = categories.map(cat => ({ ...cat, promotion_id }))
  const { data, error } = await supabase
    .from('promotion_categories')
    .insert(rows)
    .select()
  if (error) throw error
  return data
}
