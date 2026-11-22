import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { auditFetch, probeAuditHeaders, setAuditHeadersEnabled, auditHeadersEnabled } from './fetch'
import { setStaffSession, clearStaffSession } from './staffSession'

const REST = 'https://proj.supabase.co/rest/v1/orders?select=*'
const RPC = 'https://proj.supabase.co/rest/v1/rpc/create_order_with_items'
const FN = 'https://proj.supabase.co/functions/v1/verify-pin'
const AUTH = 'https://proj.supabase.co/auth/v1/token'

function sentHeaders(call) {
  return new Headers(call[1]?.headers ?? {})
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')))
  setAuditHeadersEnabled(false)
  clearStaffSession()
})
afterEach(() => vi.unstubAllGlobals())

describe('auditFetch', () => {
  it('adds nothing until the headers have been proven safe', async () => {
    setStaffSession({ id: 's1', token: 'tok', staffId: 'm1', trust: 'pin' })
    const init = { method: 'GET', headers: { apikey: 'k' } }
    await auditFetch(REST, init)
    expect(fetch).toHaveBeenCalledWith(REST, init) // the very same init object
  })

  it('adds the staff session and build to database requests once enabled', async () => {
    setAuditHeadersEnabled(true)
    setStaffSession({ id: 's1', token: 'tok-123', staffId: 'm1', trust: 'pin' })
    await auditFetch(RPC, { method: 'POST', headers: { apikey: 'k', Authorization: 'Bearer jwt' } })
    const h = sentHeaders(fetch.mock.calls[0])
    expect(h.get('x-staff-session')).toBe('tok-123')
    expect(h.get('x-app-build')).toBeTruthy()
    expect(h.get('apikey')).toBe('k')
    expect(h.get('Authorization')).toBe('Bearer jwt')
    expect(fetch.mock.calls[0][1].method).toBe('POST')
  })

  it('keeps headers passed as a Headers object', async () => {
    setAuditHeadersEnabled(true)
    await auditFetch(REST, { headers: new Headers({ apikey: 'k', Prefer: 'return=representation' }) })
    const h = sentHeaders(fetch.mock.calls[0])
    expect(h.get('Prefer')).toBe('return=representation')
    expect(h.get('x-app-build')).toBeTruthy()
  })

  it('sends only the build when nobody is signed in', async () => {
    setAuditHeadersEnabled(true)
    await auditFetch(REST, {})
    const h = sentHeaders(fetch.mock.calls[0])
    expect(h.has('x-staff-session')).toBe(false)
    expect(h.get('x-app-build')).toBeTruthy()
  })

  it('never touches edge function or auth requests (their CORS would refuse the header)', async () => {
    setAuditHeadersEnabled(true)
    setStaffSession({ id: 's1', token: 'tok', staffId: 'm1', trust: 'pin' })
    const init = { method: 'POST', headers: { apikey: 'k' } }
    await auditFetch(FN, init)
    await auditFetch(AUTH, init)
    expect(fetch).toHaveBeenNthCalledWith(1, FN, init)
    expect(fetch).toHaveBeenNthCalledWith(2, AUTH, init)
  })

  it('still makes the request when given something it cannot parse', async () => {
    setAuditHeadersEnabled(true)
    await auditFetch({ not: 'a url' }, undefined)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

describe('probeAuditHeaders', () => {
  it('enables the headers after any HTTP response, even a 404 from an old database', async () => {
    fetch.mockResolvedValueOnce(new Response('{}', { status: 404 }))
    const ok = await probeAuditHeaders({ url: 'https://proj.supabase.co/', anonKey: 'anon', accessToken: 'jwt' })
    expect(ok).toBe(true)
    expect(auditHeadersEnabled()).toBe(true)
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://proj.supabase.co/rest/v1/rpc/audit_ping')
    expect(init.headers['x-staff-session']).toBe('probe')
    expect(init.headers.Authorization).toBe('Bearer jwt')
  })

  it('leaves the headers off when the request cannot be made (offline or refused preflight)', async () => {
    fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect(await probeAuditHeaders({ url: 'https://proj.supabase.co', anonKey: 'anon' })).toBe(false)
    expect(auditHeadersEnabled()).toBe(false)
  })

  it('does nothing without a project url and key', async () => {
    expect(await probeAuditHeaders({})).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not probe again once enabled', async () => {
    setAuditHeadersEnabled(true)
    expect(await probeAuditHeaders({ url: 'https://proj.supabase.co', anonKey: 'anon' })).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
  })
})
