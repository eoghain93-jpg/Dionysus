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
import {
  newOrderId, createOrderWithItems, saveOrder,
  fetchTodaysOrders, correctOrderPaymentMethod,
} from './orders'

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

describe('fetchTodaysOrders', () => {
  it("fetches today's paid orders newest first, capped at 50", async () => {
    const rows = [{ id: 'o1', total_amount: 5.5, payment_method: 'cash', status: 'paid' }]
    supabase.__configure({ orders: { data: rows } })

    const result = await fetchTodaysOrders()

    const chain = supabase.__chain('orders')
    const today = new Date().toISOString().split('T')[0]
    expect(chain.eq).toHaveBeenCalledWith('status', 'paid')
    expect(chain.gte).toHaveBeenCalledWith('created_at', `${today}T00:00:00`)
    expect(chain.lte).toHaveBeenCalledWith('created_at', `${today}T23:59:59`)
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(chain.limit).toHaveBeenCalledWith(50)
    expect(result).toEqual(rows)
  })

  it('throws on error', async () => {
    supabase.__configure({ orders: { data: null, error: { message: 'DB error' } } })
    await expect(fetchTodaysOrders()).rejects.toThrow('DB error')
  })
})

describe('correctOrderPaymentMethod', () => {
  it('calls the RPC with order id, new method and staff id', async () => {
    supabase.rpc.mockResolvedValueOnce({ data: 'card', error: null })

    const oldMethod = await correctOrderPaymentMethod('order-1', 'cash', 'staff-1')

    expect(supabase.rpc).toHaveBeenCalledWith('correct_order_payment_method', {
      p_order_id: 'order-1',
      p_new_method: 'cash',
      p_staff_id: 'staff-1',
    })
    expect(oldMethod).toBe('card')
  })

  it('passes null staff id when none provided', async () => {
    supabase.rpc.mockResolvedValueOnce({ data: 'cash', error: null })
    await correctOrderPaymentMethod('order-1', 'card', undefined)
    expect(supabase.rpc).toHaveBeenCalledWith('correct_order_payment_method',
      expect.objectContaining({ p_staff_id: null }))
  })

  it('throws the server guard message on error', async () => {
    supabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'today has already been closed — ask the manager' },
    })
    await expect(correctOrderPaymentMethod('order-1', 'cash', 'staff-1'))
      .rejects.toThrow('already been closed')
  })
})
