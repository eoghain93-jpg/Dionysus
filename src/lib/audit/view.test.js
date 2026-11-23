import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  AUDIT_ERROR, AuditViewError, CHECK_TOOK_TOO_LONG, entryContains, fetchAuditEntries, fetchAuditHealth, fetchAuditNames,
  fetchAuditSessions, isAuditNotAvailable, markAuditChecked, mergeAuditPages, toAuditViewError, verifyAuditNow,
} from './view'
import { supabase } from '../supabase'

vi.mock('../supabase', async () => {
  const { createSupabaseMock } = await import('../../test/supabaseQueryMock')
  return { supabase: createSupabaseMock() }
})

const ok = data => ({ data, error: null })
const fail = error => ({ data: null, error })
const entry = (seq, extra = {}) => ({ seq, kind: 'row', action: 'insert', table: 'orders', ...extra })

beforeEach(() => {
  supabase.__reset()
  supabase.rpc.mockReset()
  supabase.rpc.mockResolvedValue(ok(null))
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('toAuditViewError', () => {
  it('recognises the log not being installed yet, by code or by message', () => {
    const byCode = toAuditViewError({ code: 'PGRST202', message: 'whatever' })
    const byMessage = toAuditViewError({ message: 'Could not find the function public.audit_view(p_filter) in the schema cache' })
    expect(byCode).toBeInstanceOf(AuditViewError)
    expect(byCode.kind).toBe(AUDIT_ERROR.NOT_AVAILABLE)
    expect(byCode.message).toBe('The log will be available once the database update has been applied')
    expect(byMessage.kind).toBe(AUDIT_ERROR.NOT_AVAILABLE)
    expect(isAuditNotAvailable(byCode)).toBe(true)
    expect(isAuditNotAvailable(new Error('x'))).toBe(false)
  })

  it('tells "nobody signed in" from "not a till"', () => {
    const noStaff = toAuditViewError({ code: '42501', message: 'Sign in with your PIN to view the log' })
    const notTill = toAuditViewError({ code: '42501', message: 'permission denied: till devices only' })
    const expired = toAuditViewError({ code: 'PGRST301', message: 'JWT expired' })
    expect(noStaff.kind).toBe(AUDIT_ERROR.NOT_SIGNED_IN)
    expect(notTill.kind).toBe(AUDIT_ERROR.NOT_ALLOWED)
    expect(expired.kind).toBe(AUDIT_ERROR.NOT_ALLOWED)
  })

  it('recognises a request that never reached the server', () => {
    expect(toAuditViewError(new TypeError('Failed to fetch')).kind).toBe(AUDIT_ERROR.OFFLINE)
    expect(toAuditViewError({ message: 'TypeError: NetworkError when attempting to fetch resource.' }).kind).toBe(AUDIT_ERROR.OFFLINE)
  })

  it('recognises the server running out of time', () => {
    const cancelled = toAuditViewError({ code: '57014', message: 'canceling statement due to statement timeout' })
    expect(cancelled.kind).toBe(AUDIT_ERROR.TIMEOUT)
    expect(cancelled.message).toBe('The server took too long to answer. Try again, or look at fewer days at a time.')
    expect(cancelled.cause).toMatchObject({ code: '57014' })
    expect(toAuditViewError({ status: 504, message: 'upstream request timeout' }).kind).toBe(AUDIT_ERROR.TIMEOUT)
  })

  it('keeps the message of anything else and marks it as retryable', () => {
    const other = toAuditViewError({ code: 'XX000', message: 'boom' })
    expect(other.kind).toBe(AUDIT_ERROR.FAILED)
    expect(other.message).toBe('boom')
    expect(toAuditViewError(undefined).message).toBe('Could not load the log')
  })

  it('passes an AuditViewError through untouched and keeps the cause', () => {
    const original = new AuditViewError(AUDIT_ERROR.OFFLINE)
    expect(toAuditViewError(original)).toBe(original)
    const raw = { code: 'PGRST202', message: 'm' }
    expect(toAuditViewError(raw).cause).toBe(raw)
  })
})

describe('fetchAuditEntries', () => {
  it('calls audit_view with the filter, leaving out anything empty', async () => {
    supabase.rpc.mockResolvedValue(ok({ entries: [entry(9), entry(8)], next_before_seq: null }))
    const result = await fetchAuditEntries({ unchecked: true, staff_id: '', till_id: null, kinds: [], q: undefined })
    expect(supabase.rpc).toHaveBeenCalledTimes(1)
    expect(supabase.rpc).toHaveBeenCalledWith('audit_view', { p_filter: { unchecked: true } })
    expect(result).toEqual({ entries: [entry(9), entry(8)], next_before_seq: null })
  })

  it('passes paging through', async () => {
    supabase.rpc.mockResolvedValue(ok({ entries: [], next_before_seq: null }))
    await fetchAuditEntries({ kinds: ['auth'] }, { beforeSeq: 120, limit: 50 })
    expect(supabase.rpc).toHaveBeenCalledWith('audit_view', { p_filter: { kinds: ['auth'], before_seq: 120, limit: 50 } })
  })

  it('treats no filter at all as "everything"', async () => {
    supabase.rpc.mockResolvedValue(ok({ entries: [], next_before_seq: null }))
    await fetchAuditEntries([])
    expect(supabase.rpc).toHaveBeenCalledWith('audit_view', { p_filter: {} })
  })

  it('copes with an empty or odd answer', async () => {
    supabase.rpc.mockResolvedValue(ok(null))
    expect(await fetchAuditEntries({})).toEqual({ entries: [], next_before_seq: null })
    supabase.rpc.mockResolvedValue(ok({ entries: 'nope' }))
    expect(await fetchAuditEntries({})).toEqual({ entries: [], next_before_seq: null })
  })

  it('merges several filters newest first, without repeating an entry', async () => {
    supabase.rpc
      .mockResolvedValueOnce(ok({ entries: [entry(30), entry(10)], next_before_seq: null }))
      .mockResolvedValueOnce(ok({ entries: [entry(30), entry(20)], next_before_seq: null }))
    const result = await fetchAuditEntries([{ kinds: ['row'] }, { kinds: ['event'], action_prefix: 'cart.' }], { limit: 100 })
    expect(supabase.rpc).toHaveBeenNthCalledWith(1, 'audit_view', { p_filter: { kinds: ['row'], limit: 100 } })
    expect(supabase.rpc).toHaveBeenNthCalledWith(2, 'audit_view', { p_filter: { kinds: ['event'], action_prefix: 'cart.', limit: 100 } })
    expect(result.entries.map(e => e.seq)).toEqual([30, 20, 10])
    expect(result.next_before_seq).toBeNull()
  })

  it('sends the first filter on its own before the rest', async () => {
    let finishFirst
    supabase.rpc
      .mockImplementationOnce(() => new Promise(resolve => { finishFirst = () => resolve(ok({ entries: [], next_before_seq: null })) }))
      .mockResolvedValue(ok({ entries: [], next_before_seq: null }))
    const pending = fetchAuditEntries([{ kinds: ['row'] }, { kinds: ['event'] }, { kinds: ['auth'] }])
    await Promise.resolve()
    expect(supabase.rpc).toHaveBeenCalledTimes(1)
    finishFirst()
    await pending
    expect(supabase.rpc).toHaveBeenCalledTimes(3)
  })

  it('holds back entries older than a filter that has more to give, and pages from there', async () => {
    // Filter A hit its limit at 50; filter B is complete but reaches back to 12.
    supabase.rpc
      .mockResolvedValueOnce(ok({ entries: [entry(60), entry(50)], next_before_seq: 50 }))
      .mockResolvedValueOnce(ok({ entries: [entry(55), entry(12)], next_before_seq: null }))
    const result = await fetchAuditEntries([{ kinds: ['row'] }, { kinds: ['event'] }], { limit: 2 })
    expect(result.entries.map(e => e.seq)).toEqual([60, 55, 50])
    expect(result.next_before_seq).toBe(50)
  })

  it('sends flag, changed and actors to the database as they are, with the search box alongside', async () => {
    supabase.rpc.mockResolvedValue(ok({ entries: [entry(3, { table: 'members', action: 'update', changed: ['tab_balance'] })], next_before_seq: null }))
    const filters = [
      { kinds: ['row'], tables: ['members'], changed: 'tab_balance', q: 'mo member' },
      { flag: 'direct_insert_of_sale', q: 'mo member' },
      { actors: ['database', 'service'], q: 'mo member' },
    ]
    const result = await fetchAuditEntries(filters)
    expect(supabase.rpc.mock.calls.map(c => c[1].p_filter)).toEqual(filters)
    // nothing is filtered again on the till: what the database matched is what is shown
    expect(result.entries.map(e => e.seq)).toEqual([3])
  })

  it('matches local_q on the till instead of sending it', async () => {
    supabase.rpc.mockResolvedValue(ok({
      entries: [
        entry(3, { detail: { flags: ['outside_the_till'] }, new: { name: 'Guinness' } }),
        entry(2, { detail: { flags: ['outside_the_till'] }, new: { name: 'Crisps' } }),
      ],
      next_before_seq: 2,
    }))
    const result = await fetchAuditEntries({ kinds: ['row'], q: 'outside_the_till', local_q: 'guinness' })
    expect(supabase.rpc).toHaveBeenCalledWith('audit_view', { p_filter: { kinds: ['row'], q: 'outside_the_till' } })
    expect(result.entries.map(e => e.seq)).toEqual([3])
    // paging still follows what the database returned
    expect(result.next_before_seq).toBe(2)
  })

  it('local_q finds an entry by the name of who or what it is about, as the database’s own search does', async () => {
    supabase.rpc.mockResolvedValue(ok({
      entries: [
        // an update stores only the changed columns: the name is not in them
        entry(3, { table: 'products', action: 'update', subject: 'Guinness', staff_name: 'Sam Staff', old: { standard_price: 7.4 }, new: { standard_price: 6.4 } }),
        entry(2, { table: 'products', action: 'update', subject: 'Crisps', staff_name: 'Kim Newstarter', old: { standard_price: 1 }, new: { standard_price: 1.1 } }),
      ],
      next_before_seq: null,
    }))
    expect((await fetchAuditEntries({ q: 'standard_price', local_q: 'guinness' })).entries.map(e => e.seq)).toEqual([3])
    expect((await fetchAuditEntries({ q: 'standard_price', local_q: 'kim new' })).entries.map(e => e.seq)).toEqual([2])
  })

  it('throws a recognisable error when the log is not installed', async () => {
    supabase.rpc.mockResolvedValue(fail({ code: 'PGRST202', message: 'Could not find the function public.audit_view(p_filter) in the schema cache' }))
    await expect(fetchAuditEntries({})).rejects.toMatchObject({ name: 'AuditViewError', kind: AUDIT_ERROR.NOT_AVAILABLE })
  })

  it('throws "not signed in" when the server knows of no staff member', async () => {
    supabase.rpc.mockResolvedValue(fail({ code: '42501', message: 'Sign in with your PIN to view the log' }))
    await expect(fetchAuditEntries({})).rejects.toMatchObject({ kind: AUDIT_ERROR.NOT_SIGNED_IN })
  })

  it('throws "offline" when the request itself fails', async () => {
    supabase.rpc.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(fetchAuditEntries({})).rejects.toMatchObject({ kind: AUDIT_ERROR.OFFLINE })
  })

  it('fails as a whole if any one of several filters fails', async () => {
    supabase.rpc
      .mockResolvedValueOnce(ok({ entries: [entry(1)], next_before_seq: null }))
      .mockResolvedValueOnce(fail({ code: 'XX000', message: 'boom' }))
    await expect(fetchAuditEntries([{ kinds: ['row'] }, { kinds: ['event'] }])).rejects.toMatchObject({ kind: AUDIT_ERROR.FAILED, message: 'boom' })
  })
})

describe('mergeAuditPages', () => {
  it('uses the newest cut-off when more than one filter has more to give', () => {
    const merged = mergeAuditPages([
      { entries: [entry(90), entry(80)], next_before_seq: 80 },
      { entries: [entry(85), entry(40)], next_before_seq: 40 },
      { entries: [entry(70)], next_before_seq: null },
    ])
    expect(merged.entries.map(e => e.seq)).toEqual([90, 85, 80])
    expect(merged.next_before_seq).toBe(80)
  })

  it('returns everything when nothing has more to give', () => {
    const merged = mergeAuditPages([{ entries: [entry(2)], next_before_seq: null }, { entries: [entry(5)] }, null])
    expect(merged).toEqual({ entries: [entry(5), entry(2)], next_before_seq: null })
  })
})

describe('entryContains', () => {
  const e = { action: 'update', table: 'products', subject: 'Guinness', staff_name: 'Sam Staff', old: { standard_price: 7.4 }, new: { standard_price: 6.4 }, detail: { flags: ['price_changed'] } }

  it('matches on names, values and flags, whatever the case', () => {
    expect(entryContains(e, 'GUINNESS')).toBe(true)
    expect(entryContains(e, 'sam')).toBe(true)
    expect(entryContains(e, 'price_changed')).toBe(true)
    expect(entryContains(e, '6.4')).toBe(true)
    expect(entryContains(e, 'crisps')).toBe(false)
  })

  it('matches everything when there is nothing to look for', () => {
    expect(entryContains(e, '  ')).toBe(true)
    expect(entryContains(null, 'x')).toBe(false)
  })
})

describe('the other read functions', () => {
  it('fetchAuditHealth calls audit_health', async () => {
    const health = { entries: 12, unchecked_alerts: 1 }
    supabase.rpc.mockResolvedValue(ok(health))
    expect(await fetchAuditHealth()).toEqual(health)
    expect(supabase.rpc).toHaveBeenCalledWith('audit_health')
  })

  it('fetchAuditSessions passes the dates, or nulls for the default week', async () => {
    supabase.rpc.mockResolvedValue(ok([{ id: 's1' }]))
    expect(await fetchAuditSessions('2026-11-20T00:00:00.000Z', '2026-11-22T00:00:00.000Z')).toEqual([{ id: 's1' }])
    expect(supabase.rpc).toHaveBeenCalledWith('audit_sessions', { p_from: '2026-11-20T00:00:00.000Z', p_to: '2026-11-22T00:00:00.000Z' })
    supabase.rpc.mockResolvedValue(ok(null))
    expect(await fetchAuditSessions()).toEqual([])
    expect(supabase.rpc).toHaveBeenLastCalledWith('audit_sessions', { p_from: null, p_to: null })
  })

  it('verifyAuditNow returns the result with a list of problems', async () => {
    supabase.rpc.mockResolvedValue(ok({ ok: true, rows_checked: 10, head: { code: 'S1-AAAA-BBBB' } }))
    expect(await verifyAuditNow()).toEqual({ ok: true, rows_checked: 10, head: { code: 'S1-AAAA-BBBB' }, problems: [] })
    expect(supabase.rpc).toHaveBeenCalledWith('audit_verify_now')
    supabase.rpc.mockResolvedValue(ok({ ok: false, problems: [{ problem: 'chain_broken', seal: 2 }] }))
    expect((await verifyAuditNow()).problems).toEqual([{ problem: 'chain_broken', seal: 2 }])
  })

  it('verifyAuditNow passes on how much of the log was re-read', async () => {
    const recent = { ok: true, scope: 'recent', since: '2026-10-22T12:00:00.000Z', seals_checked: 9000, seals_rehashed: 8600, rows_checked: 31000, problems: [], head: { code: 'S9000-AAAA-BBBB' } }
    supabase.rpc.mockResolvedValue(ok(recent))
    expect(await verifyAuditNow()).toEqual(recent)
  })

  it('verifyAuditNow says the nightly check still runs when the check ran out of time', async () => {
    supabase.rpc.mockResolvedValue(fail({ code: '57014', message: 'canceling statement due to statement timeout' }))
    await expect(verifyAuditNow()).rejects.toMatchObject({ name: 'AuditViewError', kind: AUDIT_ERROR.TIMEOUT, message: CHECK_TOOK_TOO_LONG })
    expect(CHECK_TOOK_TOO_LONG).toBe('The check took too long to finish here; the nightly check still runs')
    // any other failure keeps its own message
    supabase.rpc.mockResolvedValue(fail({ code: 'XX000', message: 'boom' }))
    await expect(verifyAuditNow()).rejects.toMatchObject({ kind: AUDIT_ERROR.FAILED, message: 'boom' })
  })

  it('verifyAuditNow refuses to treat an empty answer as a pass', async () => {
    supabase.rpc.mockResolvedValue(ok(null))
    await expect(verifyAuditNow()).rejects.toMatchObject({ kind: AUDIT_ERROR.FAILED })
  })

  it('markAuditChecked calls audit_ack with a trimmed note, or none', async () => {
    supabase.rpc.mockResolvedValue(ok(true))
    expect(await markAuditChecked(57, '  looked into it ')).toBe(true)
    expect(supabase.rpc).toHaveBeenCalledWith('audit_ack', { p_seq: 57, p_note: 'looked into it' })
    await markAuditChecked(58)
    expect(supabase.rpc).toHaveBeenLastCalledWith('audit_ack', { p_seq: 58, p_note: null })
    await markAuditChecked(59, '   ')
    expect(supabase.rpc).toHaveBeenLastCalledWith('audit_ack', { p_seq: 59, p_note: null })
  })

  it('markAuditChecked throws when the database says the entry is not there', async () => {
    supabase.rpc.mockResolvedValue(ok(false))
    await expect(markAuditChecked(999)).rejects.toMatchObject({ kind: AUDIT_ERROR.FAILED })
  })

  it('every function reports a missing log the same way', async () => {
    supabase.rpc.mockResolvedValue(fail({ code: 'PGRST202', message: 'Could not find the function public.audit_health in the schema cache' }))
    for (const call of [fetchAuditHealth, fetchAuditSessions, verifyAuditNow, () => markAuditChecked(1)]) {
      await expect(call()).rejects.toMatchObject({ kind: AUDIT_ERROR.NOT_AVAILABLE })
    }
  })
})

describe('fetchAuditNames', () => {
  it('builds one id-to-name lookup and the staff list', async () => {
    supabase.__configure({
      products: { data: [{ id: 'p1', name: 'Guinness' }] },
      members: { data: [
        { id: 'm2', name: 'Sam Staff', membership_tier: 'staff' },
        { id: 'm1', name: 'Kim Newstarter', membership_tier: 'staff' },
        { id: 'm3', name: 'Mo Member', membership_tier: 'member' },
      ] },
      promotions: { data: [{ id: 'x1', name: 'Happy hour' }] },
    })
    const result = await fetchAuditNames()
    expect(result.names).toEqual({ p1: 'Guinness', m1: 'Kim Newstarter', m2: 'Sam Staff', m3: 'Mo Member', x1: 'Happy hour' })
    expect(result.staff).toEqual([{ id: 'm1', name: 'Kim Newstarter' }, { id: 'm2', name: 'Sam Staff' }])
    expect(supabase.__chain('members').select).toHaveBeenCalledWith('id, name, membership_tier')
  })

  it('never asks for more than names (no PINs, no contact details)', async () => {
    await fetchAuditNames()
    for (const table of ['products', 'members', 'promotions']) {
      const columns = supabase.__chain(table).select.mock.calls[0][0]
      expect(columns).not.toMatch(/pin|phone|email|\*/)
    }
  })

  it('leaves out whatever cannot be read instead of failing', async () => {
    supabase.__configure({
      products: { data: null, error: { message: 'nope' } },
      members: { data: [{ id: 'm1', name: 'Sam Staff', membership_tier: 'staff' }] },
    })
    const result = await fetchAuditNames()
    expect(result.names).toEqual({ m1: 'Sam Staff' })
    expect(result.staff).toEqual([{ id: 'm1', name: 'Sam Staff' }])
  })

  it('survives the lookups throwing', async () => {
    const boom = () => { throw new Error('offline') }
    supabase.from.mockImplementationOnce(boom).mockImplementationOnce(boom).mockImplementationOnce(boom)
    expect(await fetchAuditNames()).toEqual({ names: {}, staff: [] })
  })
})
