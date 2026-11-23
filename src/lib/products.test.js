import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./supabase', async () => {
  const { createSupabaseMock } = await import('../test/supabaseQueryMock')
  return { supabase: createSupabaseMock() }
})
vi.mock('./db', () => ({ db: { products: { put: vi.fn(), bulkPut: vi.fn() }, pendingStockMovements: { add: vi.fn() } } }))
vi.mock('../stores/syncStore', () => ({
  useSyncStore: { getState: () => ({ isOnline: true }) },
}))

import { supabase } from './supabase'
import { upsertProduct } from './products'

beforeEach(() => supabase.__reset())

describe('upsertProduct', () => {
  const saved = { id: 'p1', name: 'Guinness', standard_price: 7.4, member_price: 6.4 }

  it('sends changed_by with a price change', async () => {
    supabase.__configure({ products: { data: saved } })
    await upsertProduct({ id: 'p1', standard_price: 7.4, changed_by: 'staff-1' })
    expect(supabase.__chain('products').update).toHaveBeenCalledWith({ standard_price: 7.4, changed_by: 'staff-1' })
    expect(supabase.from).toHaveBeenCalledTimes(1)
  })

  // The new bundle can reach a till before the database update has landed.
  it('saves without changed_by when the database does not have the column yet', async () => {
    supabase.__configure({ products: [
      { data: null, error: { code: 'PGRST204', message: "Could not find the 'changed_by' column of 'products' in the schema cache" } },
      { data: saved },
    ] })

    await expect(upsertProduct({ id: 'p1', standard_price: 7.4, changed_by: 'staff-1' })).resolves.toEqual(saved)

    expect(supabase.__chain('products', 1).update).toHaveBeenCalledWith({ standard_price: 7.4 })
  })

  it('does not retry other failures, or saves that never sent changed_by', async () => {
    supabase.__configure({ products: [{ data: null, error: { code: '23514', message: 'check constraint violated' } }] })
    await expect(upsertProduct({ id: 'p1', standard_price: -1, changed_by: 'staff-1' })).rejects.toMatchObject({ code: '23514' })
    expect(supabase.from).toHaveBeenCalledTimes(1)

    supabase.__reset({ products: [{ data: null, error: { code: 'PGRST204', message: "Could not find the 'changed_by' column" } }] })
    await expect(upsertProduct({ id: 'p1', par_level: 3 })).rejects.toBeTruthy()
    expect(supabase.from).toHaveBeenCalledTimes(1)
  })

  it('inserts a new product the same way', async () => {
    supabase.__configure({ products: { data: saved } })
    await upsertProduct({ name: 'Guinness', standard_price: 7.4, member_price: 6.4, changed_by: 'staff-1' })
    expect(supabase.__chain('products').insert).toHaveBeenCalledWith({ name: 'Guinness', standard_price: 7.4, member_price: 6.4, changed_by: 'staff-1' })
  })
})
