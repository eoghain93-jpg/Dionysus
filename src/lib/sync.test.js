import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./supabase', async () => {
  const { createSupabaseMock } = await import('../test/supabaseQueryMock')
  return { supabase: createSupabaseMock() }
})
vi.mock('./db', () => ({
  db: {
    pendingOrders: {
      toArray: vi.fn(),
      delete: vi.fn(),
      add: vi.fn(),
      count: vi.fn(),
    },
    pendingStockMovements: {
      toArray: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
  },
}))
vi.mock('../stores/syncStore', () => ({
  useSyncStore: { getState: () => ({ setOnline: vi.fn(), setPendingCount: vi.fn() }) },
}))

import { supabase } from './supabase'
import { db } from './db'
import { syncPendingOrders } from './sync'

function pendingOrder(localId, orderId) {
  return {
    localId,
    order: {
      id: orderId,
      member_id: null,
      payment_method: 'cash',
      total_amount: 9.00,
      status: 'paid',
      till_id: 'till-1',
      created_at: '2026-06-10T20:00:00.000Z',
    },
    items: [{ product_id: 'p1', quantity: 2, unit_price: 4.50, member_price_applied: false }],
  }
}

beforeEach(() => {
  supabase.__reset()
  db.pendingOrders.toArray.mockReset().mockResolvedValue([])
  db.pendingOrders.delete.mockReset().mockResolvedValue(undefined)
})

describe('syncPendingOrders', () => {
  it('replays each pending order through the atomic RPC and clears the queue', async () => {
    db.pendingOrders.toArray.mockResolvedValue([
      pendingOrder(1, 'uuid-a'),
      pendingOrder(2, 'uuid-b'),
    ])

    await syncPendingOrders()

    expect(supabase.rpc).toHaveBeenCalledTimes(2)
    expect(supabase.rpc).toHaveBeenNthCalledWith(1, 'create_order_with_items', {
      p_order: expect.objectContaining({ id: 'uuid-a' }),
      p_items: expect.any(Array),
    })
    expect(supabase.rpc).toHaveBeenNthCalledWith(2, 'create_order_with_items', {
      p_order: expect.objectContaining({ id: 'uuid-b' }),
      p_items: expect.any(Array),
    })
    expect(db.pendingOrders.delete).toHaveBeenCalledWith(1)
    expect(db.pendingOrders.delete).toHaveBeenCalledWith(2)
  })

  it('keeps the order queued and stops when the RPC returns an error', async () => {
    db.pendingOrders.toArray.mockResolvedValue([
      pendingOrder(1, 'uuid-a'),
      pendingOrder(2, 'uuid-b'),
    ])
    supabase.rpc.mockResolvedValueOnce({ data: null, error: { message: 'still down' } })

    await syncPendingOrders()

    expect(supabase.rpc).toHaveBeenCalledTimes(1) // breaks before the second order
    expect(db.pendingOrders.delete).not.toHaveBeenCalled()
  })

  it('replays with the SAME order id after a crash between insert and queue delete, so the server no-ops', async () => {
    // First sync: RPC succeeds but the queue delete fails (e.g. the browser
    // died mid-sync) — the order stays queued even though it reached the DB.
    db.pendingOrders.toArray.mockResolvedValue([pendingOrder(1, 'uuid-a')])
    db.pendingOrders.delete.mockRejectedValueOnce(new Error('IndexedDB closed'))
    await syncPendingOrders()

    // Second sync: the same entry replays. The RPC receives the identical
    // order id, so ON CONFLICT DO NOTHING makes it a no-op server-side.
    await syncPendingOrders()

    expect(supabase.rpc).toHaveBeenCalledTimes(2)
    const [firstCall, secondCall] = supabase.rpc.mock.calls
    expect(firstCall[1].p_order.id).toBe('uuid-a')
    expect(secondCall[1].p_order.id).toBe('uuid-a')
    // and this time the queue entry is cleared
    expect(db.pendingOrders.delete).toHaveBeenLastCalledWith(1)
  })

  it('does nothing when the queue is empty', async () => {
    db.pendingOrders.toArray.mockResolvedValue([])
    await syncPendingOrders()
    expect(supabase.rpc).not.toHaveBeenCalled()
  })
})
