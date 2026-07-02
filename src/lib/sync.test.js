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
import { syncPendingOrders, syncPendingStockMovements } from './sync'

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

function pendingMovement(localId, movementId) {
  return {
    localId,
    id: movementId,
    product_id: 'p1',
    type: 'wastage',
    quantity: 2,
    notes: 'dropped tray',
    till_id: 'till-1',
    created_at: '2026-06-10T20:00:00.000Z',
  }
}

beforeEach(() => {
  supabase.__reset()
  db.pendingOrders.toArray.mockReset().mockResolvedValue([])
  db.pendingOrders.delete.mockReset().mockResolvedValue(undefined)
  db.pendingStockMovements.toArray.mockReset().mockResolvedValue([])
  db.pendingStockMovements.delete.mockReset().mockResolvedValue(undefined)
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

describe('syncPendingStockMovements', () => {
  it('upserts each movement idempotently (localId stripped) and clears the queue', async () => {
    db.pendingStockMovements.toArray.mockResolvedValue([
      pendingMovement(1, 'mv-a'),
      pendingMovement(2, 'mv-b'),
    ])

    await syncPendingStockMovements()

    const chainA = supabase.__chain('stock_movements', 0)
    expect(chainA.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'mv-a', type: 'wastage', quantity: 2 }),
      { onConflict: 'id', ignoreDuplicates: true }
    )
    // localId is queue bookkeeping, not a stock_movements column
    expect(chainA.upsert.mock.calls[0][0]).not.toHaveProperty('localId')
    expect(db.pendingStockMovements.delete).toHaveBeenCalledWith(1)
    expect(db.pendingStockMovements.delete).toHaveBeenCalledWith(2)
  })

  it('keeps the movement queued and stops when the upsert returns an error', async () => {
    // supabase-js RETURNS { error } rather than throwing — the regression
    // this guards against deleted the queue entry even when the insert
    // failed, silently losing offline wastage/restock movements.
    db.pendingStockMovements.toArray.mockResolvedValue([
      pendingMovement(1, 'mv-a'),
      pendingMovement(2, 'mv-b'),
    ])
    supabase.__configure({ stock_movements: [{ data: null, error: { message: 'RLS says no' } }] })

    await syncPendingStockMovements()

    expect(db.pendingStockMovements.delete).not.toHaveBeenCalled()
    // breaks before the second movement
    expect(supabase.__chain('stock_movements', 1)).toBeUndefined()
  })

  it('replays with the SAME movement id after a crash between upsert and queue delete', async () => {
    db.pendingStockMovements.toArray.mockResolvedValue([pendingMovement(1, 'mv-a')])
    db.pendingStockMovements.delete.mockRejectedValueOnce(new Error('IndexedDB closed'))

    await syncPendingStockMovements() // delete fails, entry stays queued, no throw
    await syncPendingStockMovements()

    const first = supabase.__chain('stock_movements', 0).upsert.mock.calls[0]
    const second = supabase.__chain('stock_movements', 1).upsert.mock.calls[0]
    expect(first[0].id).toBe('mv-a')
    expect(second[0].id).toBe('mv-a')
    // ignoreDuplicates makes the second attempt a server-side no-op
    expect(second[1]).toEqual({ onConflict: 'id', ignoreDuplicates: true })
    expect(db.pendingStockMovements.delete).toHaveBeenLastCalledWith(1)
  })

  it('does nothing when the queue is empty', async () => {
    await syncPendingStockMovements()
    expect(supabase.from).not.toHaveBeenCalled()
  })
})
