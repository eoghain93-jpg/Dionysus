import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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

const { setOnline, setPendingCount } = vi.hoisted(() => ({
  setOnline: vi.fn(),
  setPendingCount: vi.fn(),
}))
vi.mock('../stores/syncStore', () => ({
  useSyncStore: { getState: () => ({ setOnline, setPendingCount }) },
}))
vi.mock('./audit/log', () => ({ logEvent: vi.fn() }))

import { supabase } from './supabase'
import { db } from './db'
import { logEvent } from './audit/log'
import { syncPendingOrders, syncPendingStockMovements, syncAll, initConnectivityListener } from './sync'

function setNavigatorOnline(value) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => value })
}

function pendingMovement(localId, notes = 'dropped a pint') {
  return {
    localId,
    product_id: 'p1',
    type: 'wastage',
    quantity: 1,
    notes,
    till_id: 'till-1',
    created_at: '2026-06-10T20:00:00.000Z',
  }
}

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

beforeEach(async () => {
  supabase.__reset()
  supabase.rpc.mockReset().mockResolvedValue({ data: null, error: null })
  db.pendingOrders.toArray.mockReset().mockResolvedValue([])
  db.pendingOrders.delete.mockReset().mockResolvedValue(undefined)
  db.pendingOrders.count.mockReset().mockResolvedValue(0)
  db.pendingStockMovements.toArray.mockReset().mockResolvedValue([])
  db.pendingStockMovements.delete.mockReset().mockResolvedValue(undefined)
  db.pendingStockMovements.count.mockReset().mockResolvedValue(0)
  setNavigatorOnline(true)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  // A clean pass makes the module forget any failure an earlier test left
  // behind (it remembers the last one so as not to repeat it in the log).
  await syncAll()
  vi.clearAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  setNavigatorOnline(true)
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

  it('keeps a failed order queued and carries on with the ones after it', async () => {
    // One bad order must not block every later sale forever.
    db.pendingOrders.toArray.mockResolvedValue([
      pendingOrder(1, 'uuid-a'),
      pendingOrder(2, 'uuid-b'),
      pendingOrder(3, 'uuid-c'),
    ])
    supabase.rpc.mockResolvedValueOnce({ data: null, error: { message: 'bad order' } })

    const result = await syncPendingOrders()

    expect(supabase.rpc).toHaveBeenCalledTimes(3)
    expect(db.pendingOrders.delete).not.toHaveBeenCalledWith(1) // still queued
    expect(db.pendingOrders.delete).toHaveBeenCalledWith(2)
    expect(db.pendingOrders.delete).toHaveBeenCalledWith(3)
    expect(result).toMatchObject({ sent: 2, failed: 1, failedId: 'uuid-a' })
    expect(result.error).toEqual({ message: 'bad order' })
  })

  it('stops the pass when the connection has gone, leaving everything queued', async () => {
    db.pendingOrders.toArray.mockResolvedValue([
      pendingOrder(1, 'uuid-a'),
      pendingOrder(2, 'uuid-b'),
    ])
    supabase.rpc.mockImplementationOnce(async () => {
      setNavigatorOnline(false)
      return { data: null, error: { message: 'TypeError: Failed to fetch' } }
    })

    const result = await syncPendingOrders()

    expect(supabase.rpc).toHaveBeenCalledTimes(1)
    expect(db.pendingOrders.delete).not.toHaveBeenCalled()
    expect(result).toMatchObject({ sent: 0, failed: 1 })
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
  it('sends each queued movement without its local id and clears the queue', async () => {
    db.pendingStockMovements.toArray.mockResolvedValue([pendingMovement(1), pendingMovement(2, 'staff drink')])

    const result = await syncPendingStockMovements()

    expect(supabase.from).toHaveBeenCalledTimes(2)
    expect(supabase.from).toHaveBeenCalledWith('stock_movements')
    const sent = supabase.__chain('stock_movements', 0).insert.mock.calls[0][0]
    expect(sent).toEqual({
      product_id: 'p1',
      type: 'wastage',
      quantity: 1,
      notes: 'dropped a pint',
      till_id: 'till-1',
      created_at: '2026-06-10T20:00:00.000Z',
    })
    expect(sent).not.toHaveProperty('localId')
    expect(db.pendingStockMovements.delete).toHaveBeenCalledWith(1)
    expect(db.pendingStockMovements.delete).toHaveBeenCalledWith(2)
    expect(result).toMatchObject({ sent: 2, failed: 0 })
  })

  it('KEEPS the movement when the insert returns an error (supabase-js does not throw)', async () => {
    // The defect: the row used to be deleted regardless, silently losing a
    // wastage or staff-drink record that was queued offline.
    db.pendingStockMovements.toArray.mockResolvedValue([pendingMovement(1)])
    supabase.__configure({ stock_movements: [{ error: { message: 'permission denied' } }] })

    const result = await syncPendingStockMovements()

    expect(db.pendingStockMovements.delete).not.toHaveBeenCalled()
    expect(result).toMatchObject({ sent: 0, failed: 1 })
    expect(result.error).toEqual({ message: 'permission denied' })
  })

  it('a refused movement does not hold back the ones queued after it', async () => {
    db.pendingStockMovements.toArray.mockResolvedValue([pendingMovement(1), pendingMovement(2), pendingMovement(3)])
    supabase.__configure({ stock_movements: [{ error: { message: 'foreign key violation' } }, { error: null }, { error: null }] })

    const result = await syncPendingStockMovements()

    expect(supabase.from).toHaveBeenCalledTimes(3)
    expect(db.pendingStockMovements.delete).toHaveBeenCalledTimes(2)
    expect(db.pendingStockMovements.delete).not.toHaveBeenCalledWith(1)
    expect(result).toMatchObject({ sent: 2, failed: 1 })
    expect(result.error).toEqual({ message: 'foreign key violation' })
  })

  it('stops sending movements once the connection has gone', async () => {
    db.pendingStockMovements.toArray.mockResolvedValue([pendingMovement(1), pendingMovement(2)])
    supabase.__configure({ stock_movements: [{ error: { message: 'Failed to fetch' } }] })
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)

    const result = await syncPendingStockMovements()
    online.mockRestore()

    expect(supabase.from).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ sent: 0, failed: 1 })
  })

  it('sends the kept movement on the next pass', async () => {
    db.pendingStockMovements.toArray.mockResolvedValue([pendingMovement(1)])
    supabase.__configure({ stock_movements: [{ error: { message: 'timeout' } }] })
    await syncPendingStockMovements()
    expect(db.pendingStockMovements.delete).not.toHaveBeenCalled()

    await syncPendingStockMovements()
    expect(db.pendingStockMovements.delete).toHaveBeenCalledWith(1)
  })

  it('does nothing when the queue is empty', async () => {
    const result = await syncPendingStockMovements()
    expect(supabase.from).not.toHaveBeenCalled()
    expect(result).toMatchObject({ sent: 0, failed: 0 })
  })
})

describe('syncAll', () => {
  it('sets the pending count to what is still queued', async () => {
    db.pendingOrders.count.mockResolvedValue(2)
    db.pendingStockMovements.count.mockResolvedValue(1)
    await syncAll()
    expect(setPendingCount).toHaveBeenCalledWith(3)
  })

  it('logs nothing when there was nothing to send', async () => {
    await syncAll()
    expect(logEvent).not.toHaveBeenCalled()
    expect(setPendingCount).toHaveBeenCalledWith(0)
  })

  it('logs one sync.replayed with what was sent', async () => {
    db.pendingOrders.toArray.mockResolvedValue([pendingOrder(1, 'uuid-a'), pendingOrder(2, 'uuid-b')])
    db.pendingStockMovements.toArray.mockResolvedValue([pendingMovement(1)])

    await syncAll()

    expect(logEvent).toHaveBeenCalledTimes(1)
    expect(logEvent).toHaveBeenCalledWith('sync.replayed', { orders: 2, stock_movements: 1 }, { severity: 1 })
  })

  it('logs at most one sync.failed per kind per pass, however many orders failed', async () => {
    db.pendingOrders.toArray.mockResolvedValue([
      pendingOrder(1, 'uuid-a'),
      pendingOrder(2, 'uuid-b'),
      pendingOrder(3, 'uuid-c'),
    ])
    db.pendingStockMovements.toArray.mockResolvedValue([pendingMovement(1), pendingMovement(2)])
    supabase.rpc
      .mockResolvedValueOnce({ data: null, error: { message: 'bad order' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'another bad order' } })
    supabase.__configure({ stock_movements: [{ error: { message: 'permission denied' } }] })

    await syncAll()

    const failures = logEvent.mock.calls.filter(c => c[0] === 'sync.failed')
    expect(failures).toHaveLength(2)
    expect(failures).toContainEqual([
      'sync.failed',
      { what: 'order', message: 'bad order', count: 2, order_id: 'uuid-a' },
      { severity: 1 },
    ])
    expect(failures).toContainEqual([
      'sync.failed',
      { what: 'stock_movement', message: 'permission denied', count: 1 },
      { severity: 1 },
    ])
    // the third order still went, and so did the movement after the refused one
    expect(logEvent).toHaveBeenCalledWith('sync.replayed', { orders: 1, stock_movements: 1 }, { severity: 1 })
  })

  it('does not repeat the same failure every pass, but reports a new reason at once', async () => {
    vi.useFakeTimers()
    db.pendingStockMovements.toArray.mockResolvedValue([pendingMovement(1)])
    supabase.__configure({ stock_movements: { error: { message: 'stuck' } } })

    await syncAll()
    await syncAll()
    await syncAll()
    expect(logEvent.mock.calls.filter(c => c[0] === 'sync.failed')).toHaveLength(1)

    supabase.__configure({ stock_movements: { error: { message: 'a different problem' } } })
    await syncAll()
    expect(logEvent.mock.calls.filter(c => c[0] === 'sync.failed')).toHaveLength(2)

    // still failing the same way half an hour later: say so again
    vi.setSystemTime(Date.now() + 31 * 60_000)
    await syncAll()
    expect(logEvent.mock.calls.filter(c => c[0] === 'sync.failed')).toHaveLength(3)
  })

  it('never rejects, and reports it, when the queue itself cannot be read', async () => {
    db.pendingOrders.toArray.mockRejectedValue(new Error('IndexedDB closed'))
    await expect(syncAll()).resolves.toBeUndefined()
    expect(logEvent).toHaveBeenCalledWith('sync.failed', { what: 'order', message: 'IndexedDB closed', count: 1 }, { severity: 1 })
  })

  it('never runs two replays at once: a second call joins the first', async () => {
    let release
    db.pendingOrders.toArray.mockReturnValue(new Promise(resolve => { release = () => resolve([]) }))

    const first = syncAll()
    const second = syncAll()
    expect(second).toBe(first)
    expect(db.pendingOrders.toArray).toHaveBeenCalledTimes(1)

    release()
    await first

    // once it has finished, the next call is a fresh replay
    db.pendingOrders.toArray.mockResolvedValue([])
    await syncAll()
    expect(db.pendingOrders.toArray).toHaveBeenCalledTimes(2)
  })
})

describe('syncAll across tabs (Web Locks, where the browser has them)', () => {
  function setLocks(locks) {
    Object.defineProperty(window.navigator, 'locks', { configurable: true, value: locks })
  }
  afterEach(() => { delete window.navigator.locks })

  it('replays under the lock when it is free', async () => {
    const request = vi.fn(async (_name, _options, callback) => callback({ name: 'held' }))
    setLocks({ request })
    db.pendingOrders.toArray.mockResolvedValue([pendingOrder(1, 'uuid-a')])

    await syncAll()

    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0][1]).toEqual({ ifAvailable: true })
    expect(db.pendingOrders.delete).toHaveBeenCalledWith(1)
  })

  it('sends nothing while another tab holds the lock, but still updates the pending count', async () => {
    setLocks({ request: vi.fn(async (_name, _options, callback) => callback(null)) })
    db.pendingOrders.toArray.mockResolvedValue([pendingOrder(1, 'uuid-a')])
    db.pendingOrders.count.mockResolvedValue(1)

    await syncAll()

    expect(db.pendingOrders.toArray).not.toHaveBeenCalled()
    expect(supabase.rpc).not.toHaveBeenCalled()
    expect(setPendingCount).toHaveBeenCalledWith(1)
  })

  it('replays without the lock if the browser refuses it — once, not twice', async () => {
    setLocks({ request: vi.fn(async () => { throw new Error('SecurityError') }) })
    db.pendingOrders.toArray.mockResolvedValue([pendingOrder(1, 'uuid-a')])

    await syncAll()

    expect(db.pendingOrders.toArray).toHaveBeenCalledTimes(1)
    expect(db.pendingOrders.delete).toHaveBeenCalledWith(1)
  })
})

describe('initConnectivityListener', () => {
  let stop
  afterEach(() => { stop?.(); stop = null })

  // lets the replay started by a timer or an event run to completion
  const settle = () => vi.advanceTimersByTimeAsync(0)

  it('replays the queue at start-up, not only when the browser fires "online"', async () => {
    vi.useFakeTimers()
    db.pendingOrders.toArray.mockResolvedValue([pendingOrder(1, 'uuid-a')])

    stop = initConnectivityListener()
    await settle()

    expect(supabase.rpc).toHaveBeenCalledWith('create_order_with_items', expect.objectContaining({
      p_order: expect.objectContaining({ id: 'uuid-a' }),
    }))
    expect(db.pendingOrders.delete).toHaveBeenCalledWith(1)
  })

  it('replays every 60 seconds while online', async () => {
    vi.useFakeTimers()
    stop = initConnectivityListener()
    await settle()
    expect(db.pendingOrders.toArray).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(59_000)
    expect(db.pendingOrders.toArray).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(db.pendingOrders.toArray).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(db.pendingOrders.toArray).toHaveBeenCalledTimes(3)
  })

  it('does not try to send while offline, but still shows how much is waiting', async () => {
    vi.useFakeTimers()
    setNavigatorOnline(false)
    db.pendingOrders.count.mockResolvedValue(4)

    stop = initConnectivityListener()
    await vi.advanceTimersByTimeAsync(120_000)

    expect(db.pendingOrders.toArray).not.toHaveBeenCalled()
    expect(supabase.rpc).not.toHaveBeenCalled()
    expect(setPendingCount).toHaveBeenCalledWith(4)
  })

  it('a slow replay is not joined by a second one when the timer comes round', async () => {
    vi.useFakeTimers()
    let release
    db.pendingOrders.toArray.mockReturnValue(new Promise(resolve => { release = () => resolve([]) }))

    stop = initConnectivityListener()
    await vi.advanceTimersByTimeAsync(180_000) // three ticks while the first is still running

    expect(db.pendingOrders.toArray).toHaveBeenCalledTimes(1)
    release()
    await settle()
  })

  it('replays and marks the till online when the connection comes back', async () => {
    vi.useFakeTimers()
    setNavigatorOnline(false)
    stop = initConnectivityListener()
    await settle()

    setNavigatorOnline(true)
    window.dispatchEvent(new Event('online'))
    await settle()

    expect(setOnline).toHaveBeenCalledWith(true)
    expect(db.pendingOrders.toArray).toHaveBeenCalledTimes(1)
  })

  it('marks the till offline when the connection drops', async () => {
    vi.useFakeTimers()
    stop = initConnectivityListener()
    await settle()
    window.dispatchEvent(new Event('offline'))
    expect(setOnline).toHaveBeenCalledWith(false)
  })

  it('calling it twice keeps ONE interval and one set of listeners', async () => {
    vi.useFakeTimers()
    stop = initConnectivityListener()
    expect(initConnectivityListener()).toBe(stop)
    await settle()
    db.pendingOrders.toArray.mockClear()

    await vi.advanceTimersByTimeAsync(60_000)
    expect(db.pendingOrders.toArray).toHaveBeenCalledTimes(1)
  })

  it('stop() ends the interval and the listeners', async () => {
    vi.useFakeTimers()
    stop = initConnectivityListener()
    await settle()
    stop()
    db.pendingOrders.toArray.mockClear()
    setOnline.mockClear()

    await vi.advanceTimersByTimeAsync(180_000)
    window.dispatchEvent(new Event('online'))
    await settle()

    expect(db.pendingOrders.toArray).not.toHaveBeenCalled()
    expect(setOnline).not.toHaveBeenCalled()
  })
})
