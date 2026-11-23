import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../supabase', async () => {
  const { createSupabaseMock } = await import('../../test/supabaseQueryMock')
  return { supabase: createSupabaseMock() }
})
vi.mock('./log', () => ({ logEvent: vi.fn() }))

import { supabase } from '../supabase'
import { logEvent } from './log'
import { witnessSeal, rememberedSeal, disputedSeals } from './seal'

const head = (id, hash) => ({ id, hash, code: `S${id}-AAAA-BBBB`, sealed_at: '2026-11-23T10:00:00Z' })

beforeEach(() => {
  localStorage.clear()
  supabase.rpc.mockReset()
  logEvent.mockClear()
})

describe('witnessSeal', () => {
  it('remembers the newest seal the first time, sending nothing to compare', async () => {
    supabase.rpc.mockResolvedValueOnce({ data: { match: null, head: head(5, 'aa') }, error: null })
    await witnessSeal()
    expect(supabase.rpc).toHaveBeenCalledWith('audit_seal_witness', { p_seal_id: null, p_hash: null })
    expect(rememberedSeal()).toMatchObject({ id: 5, hash: 'aa' })
    expect(disputedSeals()).toEqual([])
  })

  it('sends what it remembers and moves on to the newer seal when it matches', async () => {
    localStorage.setItem('audit_seal', JSON.stringify(head(5, 'aa')))
    supabase.rpc.mockResolvedValueOnce({ data: { match: true, head: head(9, 'bb') }, error: null })
    await witnessSeal()
    expect(supabase.rpc).toHaveBeenCalledWith('audit_seal_witness', { p_seal_id: 5, p_hash: 'aa' })
    expect(rememberedSeal()).toMatchObject({ id: 9, hash: 'bb' })
    expect(logEvent).not.toHaveBeenCalled()
  })

  it('on a mismatch keeps its own copy as evidence BEFORE following the database', async () => {
    localStorage.setItem('audit_seal', JSON.stringify(head(5, 'aa')))
    // History rewritten and re-sealed: the database now has more seals, none of them ours.
    supabase.rpc.mockResolvedValueOnce({ data: { match: false, head: head(12, 'zz') }, error: null })

    await witnessSeal()

    expect(disputedSeals()).toHaveLength(1)
    expect(disputedSeals()[0]).toMatchObject({ id: 5, hash: 'aa', code: 'S5-AAAA-BBBB' })
    expect(disputedSeals()[0].noticed_at).toBeTruthy()
    expect(rememberedSeal()).toMatchObject({ id: 12, hash: 'zz' })
    expect(logEvent).toHaveBeenCalledWith('integrity.seal_mismatch_seen', { remembered: 'S5-AAAA-BBBB', remembered_seal: 5 }, { severity: 2 })
  })

  it('raises a mismatch once, not on every later check-in', async () => {
    localStorage.setItem('audit_seal', JSON.stringify(head(5, 'aa')))
    supabase.rpc
      .mockResolvedValueOnce({ data: { match: false, head: head(12, 'zz') }, error: null })
      .mockResolvedValueOnce({ data: { match: true, head: head(13, 'yy') }, error: null })
    await witnessSeal()
    await witnessSeal()
    expect(logEvent).toHaveBeenCalledTimes(1)
    expect(disputedSeals()).toHaveLength(1)
  })

  it('keeps what it has when the server cannot be reached, and never throws', async () => {
    localStorage.setItem('audit_seal', JSON.stringify(head(5, 'aa')))
    supabase.rpc.mockRejectedValueOnce(new Error('offline'))
    await expect(witnessSeal()).resolves.toBeNull()
    supabase.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202' } })
    await expect(witnessSeal()).resolves.toBeNull()
    expect(rememberedSeal()).toMatchObject({ id: 5, hash: 'aa' })
  })

  it('survives unreadable storage', async () => {
    localStorage.setItem('audit_seal', '{not json')
    localStorage.setItem('audit_seal_disputed', 'nope')
    expect(rememberedSeal()).toBeNull()
    expect(disputedSeals()).toEqual([])
  })
})
