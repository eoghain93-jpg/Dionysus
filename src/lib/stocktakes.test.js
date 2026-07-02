import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./supabase', async () => {
  const { createSupabaseMock } = await import('../test/supabaseQueryMock')
  return { supabase: createSupabaseMock() }
})
vi.mock('./db', () => ({
  db: { pendingStocktakes: { add: vi.fn() } },
}))
vi.mock('./pendingCount', () => ({
  refreshPendingCount: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('./till', () => ({
  getTillId: () => 'till-1',
}))

import { supabase } from './supabase'
import { db } from './db'
import {
  buildStocktake, buildLines, summarizeVariances,
  finalizeStocktake, saveStocktake,
} from './stocktakes'

const GUINNESS = { id: 'p1', name: 'Guinness', stock_quantity: 100, standard_price: 7.40 }
const SMIRNOFF = { id: 'p2', name: 'Smirnoff', stock_quantity: 12, standard_price: 3.50 }

beforeEach(() => {
  supabase.__reset()
  db.pendingStocktakes.add.mockReset().mockResolvedValue(1)
})

describe('buildStocktake', () => {
  it('mints a client id and stamps the till, staff and window', () => {
    const st = buildStocktake({ scope: 'spirit', staffId: 's1', notes: 'note', startedAt: '2026-07-02T18:00:00Z' })
    expect(st.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(st).toMatchObject({ scope: 'spirit', staff_id: 's1', notes: 'note', till_id: 'till-1', started_at: '2026-07-02T18:00:00Z' })
    expect(st.completed_at).toEqual(expect.any(String))
  })

  it('generates unique ids per count', () => {
    expect(buildStocktake({}).id).not.toBe(buildStocktake({}).id)
  })
})

describe('buildLines', () => {
  it('snapshots expected from the product the counter was shown', () => {
    expect(buildLines([{ product: GUINNESS, countedQty: 96 }])).toEqual([
      { product_id: 'p1', expected_qty: 100, counted_qty: 96 },
    ])
  })

  it('treats missing stock_quantity as zero', () => {
    expect(buildLines([{ product: { id: 'p3' }, countedQty: 5 }])).toEqual([
      { product_id: 'p3', expected_qty: 0, counted_qty: 5 },
    ])
  })
})

describe('summarizeVariances', () => {
  it('returns only mismatches, valued at retail, biggest surprise first', () => {
    const out = summarizeVariances([
      { product: GUINNESS, countedQty: 99 },   // -1 pint  = -£7.40
      { product: SMIRNOFF, countedQty: 9 },    // -3       = -£10.50
      { product: { id: 'p4', stock_quantity: 8, standard_price: 5 }, countedQty: 8 }, // match
    ])
    expect(out.map(v => v.product.id)).toEqual(['p2', 'p1'])
    expect(out[0]).toMatchObject({ expected: 12, counted: 9, delta: -3, valueRetail: -10.50 })
  })
})

describe('finalizeStocktake', () => {
  it('calls the atomic RPC and throws on error (supabase returns, never throws)', async () => {
    supabase.rpc.mockResolvedValueOnce({ data: 'st-1', error: null })
    const result = await finalizeStocktake({ id: 'st-1' }, [])
    expect(supabase.rpc).toHaveBeenCalledWith('finalize_stocktake', {
      p_stocktake: { id: 'st-1' },
      p_lines: [],
    })
    expect(result).toBe('st-1')

    supabase.rpc.mockResolvedValueOnce({ data: null, error: { message: 'till devices only' } })
    await expect(finalizeStocktake({ id: 'st-2' }, [])).rejects.toThrow('till devices only')
  })
})

describe('saveStocktake', () => {
  const ST = { id: 'st-1' }
  const LINES = [{ product_id: 'p1', expected_qty: 100, counted_qty: 96 }]

  it('saves via the RPC when online', async () => {
    await expect(saveStocktake(ST, LINES, true)).resolves.toBe('online')
    expect(db.pendingStocktakes.add).not.toHaveBeenCalled()
  })

  it('falls back to the queue (same stocktake id) when the online save fails', async () => {
    supabase.rpc.mockResolvedValueOnce({ data: null, error: { message: 'network blip' } })
    await expect(saveStocktake(ST, LINES, true)).resolves.toBe('fallback')
    expect(db.pendingStocktakes.add).toHaveBeenCalledWith(
      expect.objectContaining({ stocktake: ST, lines: LINES, createdAt: expect.any(String) })
    )
  })

  it('queues straight to storage when offline, without calling the RPC', async () => {
    await expect(saveStocktake(ST, LINES, false)).resolves.toBe('offline')
    expect(supabase.rpc).not.toHaveBeenCalled()
    expect(db.pendingStocktakes.add).toHaveBeenCalled()
  })

  it('returns failed (never throws) when both paths fail', async () => {
    supabase.rpc.mockResolvedValueOnce({ data: null, error: { message: 'down' } })
    db.pendingStocktakes.add.mockRejectedValueOnce(new Error('quota exceeded'))
    await expect(saveStocktake(ST, LINES, true)).resolves.toBe('failed')
  })
})
