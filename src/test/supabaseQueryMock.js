// Reusable chainable Supabase client mock.
//
// Why this exists: hand-rolled per-test mocks hard-code which chained method
// is "terminal" (e.g. `.lte()` resolves the data). Every time production code
// appends another filter (`.eq()`, `.neq()`, `.in()`, ...) those mocks throw
// "x is not a function" and the suite goes red. This helper makes EVERY query
// method return the chain, and makes the chain itself thenable — resolution
// happens at `await` time, so production code can chain any combination of
// filters in any order without the mock going stale.
//
// Usage:
//
//   vi.mock('./supabase', async () => {
//     const { createSupabaseMock } = await import('../test/supabaseQueryMock')
//     return { supabase: createSupabaseMock() }
//   })
//   import { supabase } from './supabase'
//
//   beforeEach(() => supabase.__reset())
//
//   // Sticky result — every from('orders') chain resolves this:
//   supabase.__configure({ orders: { data: [...] } })
//
//   // Sequential results — consumed one per from('members') call
//   // (e.g. a select followed by an update on the same table):
//   supabase.__configure({ members: [{ data: { tab_balance: 20 } }, { error: null }] })
//
//   // Assert on the chain methods after the code under test ran:
//   expect(supabase.__chain('orders').eq).toHaveBeenCalledWith('member_id', 'm1')

import { vi } from 'vitest'

const QUERY_METHODS = [
  'select', 'insert', 'update', 'upsert', 'delete',
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte',
  'like', 'ilike', 'is', 'in', 'not', 'or', 'filter', 'match', 'contains',
  'order', 'limit', 'range',
  'single', 'maybeSingle', 'csv',
]

const DEFAULT_RESULT = { data: [], error: null }

export function createSupabaseMock(initialResults = {}) {
  let queues = {}
  let sticky = {}
  const chains = {}

  function configure(results) {
    for (const [table, result] of Object.entries(results)) {
      if (Array.isArray(result)) {
        queues[table] = [...(queues[table] ?? []), ...result]
      } else {
        sticky[table] = result
      }
    }
  }
  configure(initialResults)

  function makeChain(getResult) {
    const chain = {}
    for (const method of QUERY_METHODS) {
      chain[method] = vi.fn(() => chain)
    }
    // Thenable: awaiting the chain (after any number of chained filters)
    // resolves the configured result, mirroring supabase-js PostgrestBuilder.
    chain.then = (onFulfilled, onRejected) =>
      Promise.resolve(getResult()).then(onFulfilled, onRejected)
    chain.catch = (onRejected) => chain.then(undefined, onRejected)
    chain.finally = (onFinally) => chain.then().finally(onFinally)
    return chain
  }

  const from = vi.fn((table) => {
    // Queued results are consumed at from() time so they map 1:1 to query
    // order; sticky results are read lazily so tests can configure them
    // either before or after the chain is created.
    const queued = queues[table]?.length ? queues[table].shift() : undefined
    const getResult = () => {
      const result = queued !== undefined
        ? queued
        : (typeof sticky[table] === 'function' ? sticky[table]() : sticky[table])
      return { ...DEFAULT_RESULT, ...(result ?? {}) }
    }
    const chain = makeChain(getResult)
    ;(chains[table] ??= []).push(chain)
    return chain
  })

  const supabase = {
    from,
    rpc: vi.fn(async () => ({ data: null, error: null })),
    functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
    /** All chains created so far, keyed by table name, in creation order. */
    __chains: chains,
    /** Nth chain created for a table (default: first). */
    __chain: (table, index = 0) => chains[table]?.[index],
    /** Set results: object = sticky per table, array = queue consumed per from() call. */
    __configure: configure,
    /** Clear results, chains, and call history, then optionally configure. */
    __reset: (results = {}) => {
      queues = {}
      sticky = {}
      for (const table of Object.keys(chains)) delete chains[table]
      from.mockClear()
      supabase.rpc.mockClear()
      supabase.functions.invoke.mockClear()
      configure(results)
    },
  }
  return supabase
}
