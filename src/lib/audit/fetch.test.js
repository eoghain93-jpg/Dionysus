import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { auditFetch, probeAuditHeaders, setAuditHeadersEnabled, auditHeadersEnabled } from './fetch'
import { setStaffSession, clearStaffSession } from './staffSession'
import { markReached, markUnreachable, serverUnreachable, answersSeen } from './reachability'

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

// How the till learns the server is back after an outage (./reachability.js).
describe('auditFetch — noting that the server answered', () => {
  beforeEach(() => markUnreachable())
  afterEach(() => markReached())

  it('notes an answer to a database write or function call', async () => {
    await auditFetch(RPC, { method: 'POST', headers: { apikey: 'k' } })
    expect(serverUnreachable()).toBe(false)
  })

  it('notes it whether or not the audit headers are switched on', async () => {
    setAuditHeadersEnabled(true)
    await auditFetch(REST, { method: 'PATCH' })
    expect(serverUnreachable()).toBe(false)
  })

  it('any HTTP answer counts, even an error from a database that lacks the function', async () => {
    fetch.mockResolvedValueOnce(new Response('{}', { status: 404 }))
    await auditFetch(RPC, { method: 'POST' })
    expect(serverUnreachable()).toBe(false)
  })

  it('does not count a read: the service worker can answer a GET from its cache on a dead line', async () => {
    await auditFetch(REST, { method: 'GET' })
    await auditFetch(REST, {})
    await auditFetch(REST)
    expect(serverUnreachable()).toBe(true)
  })

  it('does not count edge function or auth requests', async () => {
    await auditFetch(FN, { method: 'POST' })
    await auditFetch(AUTH, { method: 'POST' })
    expect(serverUnreachable()).toBe(true)
  })

  it('hands the caller the very promise fetch returned, with the same request', async () => {
    const init = { method: 'POST', headers: { apikey: 'k' } }
    const response = new Response('{}')
    const promise = Promise.resolve(response)
    fetch.mockReturnValueOnce(promise)

    const returned = auditFetch(RPC, init)

    expect(returned).toBe(promise)
    expect(await returned).toBe(response)
    expect(fetch).toHaveBeenCalledWith(RPC, init)
  })

  it('a request that fails still rejects for the caller with the same error, and nothing is noted', async () => {
    const failure = new TypeError('Failed to fetch')
    fetch.mockRejectedValueOnce(failure)
    const before = answersSeen()

    await expect(auditFetch(RPC, { method: 'POST' })).rejects.toBe(failure)

    expect(serverUnreachable()).toBe(true)
    expect(answersSeen()).toBe(before)
  })

  it('never throws because of the note-taking', () => {
    fetch.mockReturnValueOnce(undefined) // not even a promise
    expect(auditFetch(RPC, { method: 'POST' })).toBeUndefined()
    expect(serverUnreachable()).toBe(true)
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
