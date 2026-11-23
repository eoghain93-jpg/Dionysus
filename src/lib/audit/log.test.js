import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { logEvent, flushEvents, __setOutbox } from './log'
import { setStaffSession, clearStaffSession } from './staffSession'
import { useSessionStore } from '../../stores/sessionStore'

let box

beforeEach(() => {
  vi.useFakeTimers()
  box = { enqueue: vi.fn(async () => {}), flush: vi.fn(async () => 0), pending: vi.fn(async () => 0), takeDropped: vi.fn(() => 0) }
  __setOutbox(box)
  clearStaffSession()
  useSessionStore.setState({ activeStaff: null })
})
afterEach(() => {
  vi.runOnlyPendingTimers() // let any scheduled flush fire so it cannot leak into the next test
  vi.useRealTimers()
  __setOutbox(null)
})

describe('logEvent', () => {
  it('queues an event with an id, the time, the session and who is signed in', () => {
    setStaffSession({ id: 'sess-1', token: 'secret-token', staffId: 'staff-1', trust: 'pin' })
    useSessionStore.setState({ activeStaff: { id: 'staff-1', name: 'Sam Staff' } })

    logEvent('cart.line_removed', { product: 'Guinness', quantity: 2, value: 14.8 }, { severity: 1 })

    const e = box.enqueue.mock.calls[0][0]
    expect(e.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(e.type).toBe('cart.line_removed')
    expect(e.severity).toBe(1)
    expect(e.session_id).toBe('sess-1')
    expect(e.staff_id).toBe('staff-1')
    expect(new Date(e.at).toString()).not.toBe('Invalid Date')
    expect(e.detail).toMatchObject({ product: 'Guinness', quantity: 2, value: 14.8, till: expect.any(String) })
  })

  it('never puts the session token in an event', () => {
    setStaffSession({ id: 'sess-1', token: 'secret-token', staffId: 'staff-1', trust: 'pin' })
    logEvent('app.started')
    expect(JSON.stringify(box.enqueue.mock.calls[0][0])).not.toContain('secret-token')
  })

  it('works with nobody signed in', () => {
    logEvent('app.started')
    const e = box.enqueue.mock.calls[0][0]
    expect(e.session_id).toBeNull()
    expect(e.staff_id).toBeNull()
    expect(e.severity).toBe(0)
  })

  it('sends notable events within a couple of seconds, routine ones on the timer', () => {
    logEvent('page.viewed')
    vi.advanceTimersByTime(5000)
    expect(box.flush).not.toHaveBeenCalled()

    logEvent('drawer.opened_no_sale', {}, { severity: 2 })
    logEvent('cart.order_voided', {}, { severity: 1 })
    vi.advanceTimersByTime(1500)
    expect(box.flush).toHaveBeenCalledTimes(1)
  })

  it('notes how many earlier events were dropped from a full queue', () => {
    box.takeDropped.mockReturnValueOnce(7)
    logEvent('app.started')
    expect(box.enqueue.mock.calls[0][0].detail.events_dropped_before_this).toBe(7)
  })

  it('never throws, even if the queue does', async () => {
    box.enqueue.mockImplementation(() => { throw new Error('boom') })
    expect(() => logEvent('app.started')).not.toThrow()
    box.enqueue.mockImplementation(async () => { throw new Error('boom') })
    expect(() => logEvent('app.started')).not.toThrow()
    box.flush.mockImplementation(() => { throw new Error('boom') })
    await expect(flushEvents()).resolves.toBe(0)
  })
})
