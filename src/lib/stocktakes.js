import { supabase } from './supabase'
import { db } from './db'
import { getTillId } from './till'
import { newClientId } from './clientId'
import { refreshPendingCount } from './pendingCount'

// Guided stocktake data layer. A finished count becomes ONE atomic RPC call
// (finalize_stocktake): header + lines + relative adjustment movements +
// last_counted_at, idempotent via the client-generated stocktake id — the
// same save/queue/replay scheme orders use, because counts happen in a
// cellar with the worst wifi in the building.

export function buildStocktake({ scope = 'all', staffId = null, notes = null, startedAt, tillId = getTillId() }) {
  return {
    id: newClientId(),
    scope,
    staff_id: staffId,
    notes,
    till_id: tillId,
    started_at: startedAt ?? new Date().toISOString(),
    completed_at: new Date().toISOString(),
  }
}

// counts: [{ product, countedQty }] → RPC lines. expected_qty snapshots the
// stock figure the manager was shown at count time; the server turns the
// difference into a relative adjustment and values the variance itself.
export function buildLines(counts) {
  return counts.map(({ product, countedQty }) => ({
    product_id: product.id,
    expected_qty: Number(product.stock_quantity ?? 0),
    counted_qty: Number(countedQty),
  }))
}

// The "only the surprises" review screen: counted products whose count
// disagrees with expectation, valued at retail, biggest surprise first.
// (Display-side valuation only — the DB row is valued server-side.)
export function summarizeVariances(counts) {
  return counts
    .map(({ product, countedQty }) => {
      const expected = Number(product.stock_quantity ?? 0)
      const delta = Number(countedQty) - expected
      return {
        product,
        expected,
        counted: Number(countedQty),
        delta,
        valueRetail: Math.round(delta * Number(product.standard_price ?? 0) * 100) / 100,
      }
    })
    .filter(v => v.delta !== 0)
    .sort((a, b) => Math.abs(b.valueRetail) - Math.abs(a.valueRetail))
}

export async function finalizeStocktake(stocktake, lines) {
  const { data, error } = await supabase.rpc('finalize_stocktake', {
    p_stocktake: stocktake,
    p_lines: lines,
  })
  if (error) throw error
  return data
}

// Save the count atomically online, falling back to the offline queue.
// NEVER throws — a manager who just counted the whole cellar must not lose
// the count to a wifi blip. Same result contract as saveOrder:
//   'online' | 'offline' | 'fallback' | 'failed'
export async function saveStocktake(stocktake, lines, isOnline) {
  if (isOnline) {
    try {
      await finalizeStocktake(stocktake, lines)
      return 'online'
    } catch (err) {
      console.error('Stocktake save failed:', err)
      try {
        await queueStocktake(stocktake, lines)
        return 'fallback'
      } catch (queueErr) {
        console.error('Offline queue also failed:', queueErr)
        return 'failed'
      }
    }
  }
  try {
    await queueStocktake(stocktake, lines)
    return 'offline'
  } catch (err) {
    console.error('Offline queue failed:', err)
    return 'failed'
  }
}

async function queueStocktake(stocktake, lines) {
  await db.pendingStocktakes.add({ stocktake, lines, createdAt: new Date().toISOString() })
  // Fire-and-forget: the badge refresh must never turn a queued count into
  // a 'failed' one.
  refreshPendingCount().catch(() => {})
}
