import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./supabase', async () => {
  const { createSupabaseMock } = await import('../test/supabaseQueryMock')
  return { supabase: createSupabaseMock() }
})
vi.mock('./db', () => ({
  db: { pendingOrders: { add: vi.fn() } },
}))

import { supabase } from './supabase'
import { db } from './db'
import { newOrderId, createOrderWithItems, saveOrder } from './orders'

const ORDER = {
  id: 'order-uuid-1',
  member_id: null,
  payment_method: 'cash',
  total_amount: 9.00,
  status: 'paid',
  till_id: 'till-1',
  created_at: '2026-06-10T20:00:00.000Z',
}
const ITEMS = [
  { product_id: 'p1', quantity: 2, unit_price: 4.50, member_price_applied: false },
]

beforeEach(() => {
  supabase.__reset()
  db.pendingOrders.add.mockReset().mockResolvedValue(1)
})

describe('newOrderId', () => {
  const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

  it('returns a v4 UUID', () => {
    expect(newOrderId()).toMatch(UUID_V4)
  })

  it('returns unique ids', () => {
    expect(newOrderId()).not.toBe(newOrderId())
  })

  it('falls back to getRandomValues when randomUUID is unavailable (http on the LAN)', () => {
    const realCrypto = globalThis.crypto
    vi.stubGlobal('crypto', {
      getRandomValues: realCrypto.getRandomValues.bind(realCrypto),
    })
    try {
      expect(newOrderId()).toMatch(UUID_V4)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('createOrderWithItems', () => {
  it('calls the create_order_with_items RPC with the order and items', async () => {
    supabase.rpc.mockResolvedValueOnce({ data: ORDER.id, error: null })

    const result = await createOrderWithItems(ORDER, ITEMS)

    expect(supabase.rpc).toHaveBeenCalledWith('create_order_with_items', {
      p_order: ORDER,
      p_items: ITEMS,
    })
    expect(result).toBe(ORDER.id)
  })

  it('throws when the RPC returns an error (Supabase returns, never throws)', async () => {
    supabase.rpc.mockResolvedValueOnce({ data: null, error: { message: 'permission denied' } })
    await expect(createOrderWithItems(ORDER, ITEMS)).rejects.toThrow('permission denied')
  })
})

describe('saveOrder', () => {
  it('saves via the RPC when online and does not touch the offline queue', async () => {
    const result = await saveOrder(ORDER, ITEMS, true)
    expect(result).toBe('online')
    expect(supabase.rpc).toHaveBeenCalledOnce()
    expect(db.pendingOrders.add).not.toHaveBeenCalled()
  })

  it('falls back to the offline queue when the online save fails', async () => {
    supabase.rpc.mockResolvedValueOnce({ data: null, error: { message: 'network blip' } })

    const result = await saveOrder(ORDER, ITEMS, true)

    expect(result).toBe('fallback')
    expect(db.pendingOrders.add).toHaveBeenCalledWith({ order: ORDER, items: ITEMS })
  })

  it('queues straight to offline storage when offline, without calling the RPC', async () => {
    const result = await saveOrder(ORDER, ITEMS, false)

    expect(result).toBe('offline')
    expect(supabase.rpc).not.toHaveBeenCalled()
    expect(db.pendingOrders.add).toHaveBeenCalledWith({ order: ORDER, items: ITEMS })
  })

  it('returns failed (never throws) when both the RPC and the queue fail', async () => {
    supabase.rpc.mockResolvedValueOnce({ data: null, error: { message: 'down' } })
    db.pendingOrders.add.mockRejectedValueOnce(new Error('quota exceeded'))

    await expect(saveOrder(ORDER, ITEMS, true)).resolves.toBe('failed')
  })

  it('returns failed (never throws) when offline and the queue fails', async () => {
    db.pendingOrders.add.mockRejectedValueOnce(new Error('quota exceeded'))
    await expect(saveOrder(ORDER, ITEMS, false)).resolves.toBe('failed')
  })

  it('keeps the same order id on the queued order so a later sync replay is a no-op', async () => {
    supabase.rpc.mockResolvedValueOnce({ data: null, error: { message: 'network blip' } })
    await saveOrder(ORDER, ITEMS, true)
    const queued = db.pendingOrders.add.mock.calls[0][0]
    expect(queued.order.id).toBe(ORDER.id)
  })
})
