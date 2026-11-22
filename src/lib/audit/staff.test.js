import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../supabase', async () => {
  const { createSupabaseMock } = await import('../../test/supabaseQueryMock')
  return { supabase: createSupabaseMock() }
})

import { supabase } from '../supabase'
import { signInStaff, verifyStaffPin, signOutStaff, setStaffPin } from './staff'
import { getStaffSession, setStaffSession, clearStaffSession } from './staffSession'

const SESSION = { id: 'sess-1', token: 'tok-1' }

beforeEach(() => {
  supabase.__reset()
  supabase.rpc.mockReset()
  supabase.functions.invoke.mockReset()
  clearStaffSession()
})

describe('signInStaff', () => {
  it('checks the PIN in the database and keeps the session it returns', async () => {
    supabase.rpc.mockResolvedValueOnce({ data: { valid: true, member: { id: 'm1', name: 'Sam' }, session: SESSION }, error: null })

    const res = await signInStaff('m1', '4821')

    expect(supabase.rpc).toHaveBeenCalledWith('staff_sign_in', { p_member_id: 'm1', p_pin: '4821' })
    expect(res.valid).toBe(true)
    expect(res.member).toEqual({ id: 'm1', name: 'Sam' })
    expect(getStaffSession()).toEqual({ id: 'sess-1', token: 'tok-1', staffId: 'm1', trust: 'pin' })
    expect(supabase.functions.invoke).not.toHaveBeenCalled()
  })

  it('passes a wrong-PIN answer straight through and opens no session', async () => {
    supabase.rpc.mockResolvedValueOnce({ data: { valid: false, attemptsRemaining: 3 }, error: null })
    expect(await signInStaff('m1', '0000')).toEqual({ valid: false, attemptsRemaining: 3 })
    expect(getStaffSession()).toBeNull()
    expect(supabase.functions.invoke).not.toHaveBeenCalled()
  })

  it('passes a lockout through unchanged', async () => {
    supabase.rpc.mockResolvedValueOnce({ data: { valid: false, reason: 'locked', retryAfterSeconds: 900 }, error: null })
    expect(await signInStaff('m1', '0000')).toEqual({ valid: false, reason: 'locked', retryAfterSeconds: 900 })
  })

  it('falls back to verify-pin when the database cannot check, and registers a claimed session', async () => {
    supabase.rpc
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } })
      .mockResolvedValueOnce({ data: { valid: true, session: { id: 'sess-2', token: 'tok-2' } }, error: null })
    supabase.functions.invoke.mockResolvedValueOnce({ data: { valid: true, member: { id: 'm1', name: 'Sam' } }, error: null })

    const res = await signInStaff('m1', '4821')

    expect(supabase.functions.invoke).toHaveBeenCalledWith('verify-pin', { body: { member_id: 'm1', pin: '4821' } })
    expect(supabase.rpc).toHaveBeenLastCalledWith('staff_session_claim', { p_member_id: 'm1' })
    expect(res.valid).toBe(true)
    expect(getStaffSession()).toEqual({ id: 'sess-2', token: 'tok-2', staffId: 'm1', trust: 'claimed' })
  })

  it('still signs in through verify-pin on a database with no sessions at all', async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'missing' } })
    supabase.functions.invoke.mockResolvedValueOnce({ data: { valid: true, member: { id: 'm1', name: 'Sam' } }, error: null })
    setStaffSession({ id: 'old', token: 'old-tok', staffId: 'someone-else', trust: 'pin' })

    const res = await signInStaff('m1', '4821')

    expect(res.valid).toBe(true)
    expect(getStaffSession()).toBeNull() // never keep the previous person's session
  })

  it('does not claim a session when verify-pin says the PIN is wrong', async () => {
    supabase.rpc.mockRejectedValueOnce(new Error('network'))
    supabase.functions.invoke.mockResolvedValueOnce({ data: { valid: false, attemptsRemaining: 4 }, error: null })
    expect(await signInStaff('m1', '0000')).toEqual({ valid: false, attemptsRemaining: 4 })
    expect(supabase.rpc).toHaveBeenCalledTimes(1)
  })

  it('rejects only when neither path can be reached', async () => {
    supabase.rpc.mockRejectedValueOnce(new Error('network'))
    supabase.functions.invoke.mockResolvedValueOnce({ data: null, error: new Error('offline') })
    await expect(signInStaff('m1', '4821')).rejects.toThrow('offline')
  })
})

describe('verifyStaffPin', () => {
  it('re-checks in the database with the purpose, and changes no session', async () => {
    setStaffSession({ id: 'sess-1', token: 'tok-1', staffId: 'm1', trust: 'pin' })
    supabase.rpc.mockResolvedValueOnce({ data: { valid: true }, error: null })

    expect(await verifyStaffPin('m1', '4821', 'z_report')).toEqual({ valid: true })
    expect(supabase.rpc).toHaveBeenCalledWith('staff_verify_pin', { p_member_id: 'm1', p_pin: '4821', p_purpose: 'z_report' })
    expect(getStaffSession().id).toBe('sess-1')
  })

  it('falls back to verify-pin', async () => {
    supabase.rpc.mockResolvedValueOnce({ data: null, error: { message: 'unsupported PIN hash format' } })
    supabase.functions.invoke.mockResolvedValueOnce({ data: { valid: true, member: { id: 'm1', name: 'Sam' } }, error: null })
    expect((await verifyStaffPin('m1', '4821', 'price_change')).valid).toBe(true)
  })
})

describe('signOutStaff', () => {
  it('ends the session on the server and forgets the token', async () => {
    setStaffSession({ id: 'sess-1', token: 'tok-1', staffId: 'm1', trust: 'pin' })
    supabase.rpc.mockResolvedValueOnce({ data: true, error: null })
    await signOutStaff('idle_lock')
    expect(supabase.rpc).toHaveBeenCalledWith('staff_sign_out', { p_reason: 'idle_lock' })
    expect(getStaffSession()).toBeNull()
  })

  it('never throws and still forgets the token when the server cannot be reached', async () => {
    setStaffSession({ id: 'sess-1', token: 'tok-1', staffId: 'm1', trust: 'pin' })
    supabase.rpc.mockRejectedValueOnce(new Error('offline'))
    await expect(signOutStaff()).resolves.toBeUndefined()
    expect(getStaffSession()).toBeNull()
  })

  it('makes no request when nobody has a session', async () => {
    await signOutStaff()
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it('does not forget a newer session that replaced this one mid-request', async () => {
    setStaffSession({ id: 'sess-1', token: 'tok-1', staffId: 'm1', trust: 'pin' })
    supabase.rpc.mockImplementationOnce(async () => {
      setStaffSession({ id: 'sess-2', token: 'tok-2', staffId: 'm2', trust: 'pin' })
      return { data: true, error: null }
    })
    await signOutStaff('switch_user')
    expect(getStaffSession().id).toBe('sess-2')
  })
})

describe('setStaffPin', () => {
  it('sets the PIN in the database', async () => {
    supabase.rpc.mockResolvedValueOnce({ data: { success: true }, error: null })
    expect(await setStaffPin('m1', '2468', '4821')).toEqual({ success: true })
    expect(supabase.rpc).toHaveBeenCalledWith('staff_set_pin', { p_member_id: 'm1', p_new_pin: '2468', p_current_pin: '4821' })
  })

  it('returns the database refusal as-is', async () => {
    supabase.rpc.mockResolvedValueOnce({ data: { error: 'Incorrect current PIN' }, error: null })
    expect(await setStaffPin('m1', '2468', '0000')).toEqual({ error: 'Incorrect current PIN' })
    expect(supabase.functions.invoke).not.toHaveBeenCalled()
  })

  it('falls back to verify-pin set mode', async () => {
    supabase.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'missing' } })
    supabase.functions.invoke.mockResolvedValueOnce({ data: { success: true }, error: null })
    expect(await setStaffPin('m1', '2468')).toEqual({ success: true })
    expect(supabase.functions.invoke).toHaveBeenCalledWith('verify-pin', { body: { member_id: 'm1', pin: '2468', mode: 'set' } })
  })

  it('surfaces the reason when verify-pin refuses', async () => {
    supabase.rpc.mockRejectedValueOnce(new Error('network'))
    supabase.functions.invoke.mockResolvedValueOnce({
      data: null,
      error: { message: 'Edge Function returned a non-2xx status code', context: { json: async () => ({ error: 'Incorrect current PIN' }) } },
    })
    expect(await setStaffPin('m1', '2468', '0000')).toEqual({ error: 'Incorrect current PIN' })
  })
})
