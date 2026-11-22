import { describe, it, expect, vi } from 'vitest'
import { createOutbox, memoryStore, MAX_QUEUED, BATCH_SIZE } from './outbox'

function ev(i) {
  return { id: `e${String(i).padStart(5, '0')}`, type: 'test.event', at: new Date(1_700_000_000_000 + i * 1000).toISOString() }
}

function setup(overrides = {}) {
  const store = memoryStore()
  const send = vi.fn(async () => ({ accepted: 1 }))
  let t = 0
  const clock = { advance: ms => { t += ms } }
  const outbox = createOutbox({ store, send, now: () => t, ...overrides })
  return { store, send, outbox, clock }
}

describe('audit outbox', () => {
  it('delivers queued events oldest first and removes them', async () => {
    const { outbox, send, store } = setup()
    await outbox.enqueue(ev(2))
    await outbox.enqueue(ev(1))
    expect(await outbox.flush()).toBe(2)
    expect(send.mock.calls[0][0].map(e => e.id)).toEqual(['e00001', 'e00002'])
    expect(await store.count()).toBe(0)
  })

  it('keeps everything when the send fails, then delivers after the back-off', async () => {
    const { outbox, send, clock } = setup()
    send.mockRejectedValueOnce(new Error('network'))
    await outbox.enqueue(ev(1))
    expect(await outbox.flush()).toBe(0)
    expect(await outbox.pending()).toBe(1)

    expect(await outbox.flush()).toBe(0) // still backing off: no request
    expect(send).toHaveBeenCalledTimes(1)

    clock.advance(11_000)
    expect(await outbox.flush()).toBe(1)
    expect(await outbox.pending()).toBe(0)
  })

  it('waits five minutes when the database has no audit function yet', async () => {
    const { outbox, send, clock } = setup()
    send.mockRejectedValueOnce({ code: 'PGRST202', message: 'Could not find the function public.audit_log_events' })
    await outbox.enqueue(ev(1))
    await outbox.flush()
    clock.advance(4 * 60_000)
    await outbox.flush()
    expect(send).toHaveBeenCalledTimes(1)
    clock.advance(61_000)
    expect(await outbox.flush()).toBe(1)
  })

  it('does not send while offline', async () => {
    const { outbox, send } = setup({ isOnline: () => false })
    await outbox.enqueue(ev(1))
    expect(await outbox.flush()).toBe(0)
    expect(send).not.toHaveBeenCalled()
    expect(await outbox.pending()).toBe(1)
  })

  it('never sends the same batch twice when flushes overlap', async () => {
    const { outbox, send } = setup()
    let release
    send.mockImplementationOnce(() => new Promise(r => { release = r }))
    await outbox.enqueue(ev(1))
    const a = outbox.flush()
    const b = outbox.flush()
    await Promise.resolve()
    release({})
    expect(await a).toBe(1)
    expect(await b).toBe(1)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('sends a large backlog in batches', async () => {
    const { outbox, send } = setup()
    for (let i = 0; i < BATCH_SIZE * 2 + 5; i++) await outbox.enqueue(ev(i))
    expect(await outbox.flush()).toBe(BATCH_SIZE * 2 + 5)
    expect(send.mock.calls.map(c => c[0].length)).toEqual([BATCH_SIZE, BATCH_SIZE, 5])
  })

  it('caps the queue, dropping the oldest, and reports how many were dropped once', async () => {
    const { outbox, store } = setup()
    for (let i = 0; i < MAX_QUEUED + 3; i++) await store.add(ev(i))
    await outbox.enqueue(ev(MAX_QUEUED + 3))
    expect(await store.count()).toBe(MAX_QUEUED)
    expect((await store.oldest(1))[0].id).toBe('e00004')
    expect(outbox.takeDropped()).toBe(4)
    expect(outbox.takeDropped()).toBe(0)
  })

  it('falls back to memory when the durable queue is unavailable, and still delivers', async () => {
    const broken = {
      add: vi.fn(async () => { throw new Error('IndexedDB unavailable') }),
      oldest: vi.fn(async () => []),
      remove: vi.fn(async () => {}),
      count: vi.fn(async () => 0),
    }
    const send = vi.fn(async () => ({}))
    const outbox = createOutbox({ store: broken, send })
    await outbox.enqueue(ev(1))
    expect(await outbox.pending()).toBe(1)
    expect(await outbox.flush()).toBe(1)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('enqueue never throws, whatever the stores do', async () => {
    const dead = { add: async () => { throw new Error('x') }, oldest: async () => { throw new Error('x') }, remove: async () => {}, count: async () => { throw new Error('x') } }
    const outbox = createOutbox({ store: dead, send: async () => {} })
    await expect(outbox.enqueue(ev(1))).resolves.toBeUndefined()
    await expect(outbox.flush()).resolves.toBe(0)
  })
})
