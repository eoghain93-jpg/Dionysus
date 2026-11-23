import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const { mockSignOut, mockRpc } = vi.hoisted(() => ({ mockSignOut: vi.fn(), mockRpc: vi.fn() }))

vi.mock('../lib/tabs', () => ({
  fetchTabAges: vi.fn().mockResolvedValue({
    m1: { days: 20, overdue: true },
    m2: { days: 30, overdue: true },
    m3: { days: 2, overdue: false },
  }),
}))

vi.mock('./till/SwitchUserModal', () => ({
  default: () => null,
}))
vi.mock('./ui/DaveyMode', () => ({
  default: () => <div data-testid="davey-mode" />,
}))
vi.mock('../lib/audit/staff', () => ({ signOutStaff: mockSignOut }))
vi.mock('../lib/audit/log', () => ({ logEvent: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: { rpc: mockRpc } }))

import NavBar from './NavBar'
import { useSessionStore } from '../stores/sessionStore'
import { useToastStore } from '../hooks/useToast'
import { setStaffSession, getStaffSession } from '../lib/audit/staffSession'
import { markReached, markUnreachable, serverUnreachable } from '../lib/audit/reachability'
import { logEvent } from '../lib/audit/log'

const ALICE = { id: 'staff-1', name: 'Alice' }

function setNavigatorOnline(value) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => value })
}

function renderNav() {
  return render(<MemoryRouter><NavBar /></MemoryRouter>)
}

const session = () => useSessionStore.getState()
const lastToast = () => useToastStore.getState().toasts.at(-1)?.message

// In the app the fetch wrapper notes every answer the server gives to a
// database write (lib/audit/reachability.js). Here the server is these two
// mocks, so they do the noting: `answers` = the server is there, `noAnswer`
// = the request failed without one (broadband down, Wi-Fi up).
const answers = async () => { markReached() }
const noAnswer = async () => {}
const pings = () => mockRpc.mock.calls.filter(c => c[0] === 'audit_ping')

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  setNavigatorOnline(true)
  markReached()
  useSessionStore.setState({ activeStaff: ALICE, locked: false })
  useToastStore.setState({ toasts: [] })
  setStaffSession({ id: 'sess-1', token: 'tok-1', staffId: 'staff-1', trust: 'pin' })
  mockSignOut.mockReset().mockImplementation(answers)
  mockRpc.mockReset().mockImplementation(answers)
})

afterEach(() => {
  cleanup() // unmount before the store is reset
  vi.useRealTimers()
  setNavigatorOnline(true)
  markReached()
  setStaffSession(null)
  useSessionStore.setState({ activeStaff: null, locked: false })
})

describe('NavBar', () => {
  it('renders all navigation links', () => {
    renderNav()
    expect(screen.getAllByText('Till').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Stock').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Members').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Reports').length).toBeGreaterThan(0)
  })

  it('offers no staff controls when nobody is signed in', () => {
    useSessionStore.setState({ activeStaff: null })
    renderNav()
    expect(screen.queryByRole('button', { name: /lock till/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /sign out/i })).not.toBeInTheDocument()
  })

  // ── Lock ───────────────────────────────────────────────────────────────────
  it('Lock locks the till, logs it as manual, and ends the server session — whose till it is stays on show', async () => {
    renderNav()
    fireEvent.click(screen.getByRole('button', { name: /lock till/i }))

    expect(session().locked).toBe(true)
    expect(session().activeStaff).toEqual(ALICE)
    expect(logEvent).toHaveBeenCalledTimes(1)
    expect(logEvent).toHaveBeenCalledWith('till.locked', { reason: 'manual', minutes: 5 }, { severity: 0 })
    // a locked till holds no sign-in: nothing done at it can be recorded as Alice
    await waitFor(() => expect(mockSignOut).toHaveBeenCalledTimes(1))
    expect(mockSignOut).toHaveBeenCalledWith('manual_lock')
    expect(getStaffSession()).toBeNull()
  })

  it('Lock works while offline (the lock screen can carry on unchecked)', () => {
    setNavigatorOnline(false)
    renderNav()
    fireEvent.click(screen.getByRole('button', { name: /lock till/i }))
    expect(session().locked).toBe(true)
  })

  it('Lock is in the mobile More sheet too', () => {
    renderNav()
    fireEvent.click(screen.getByRole('button', { name: /more navigation options/i }))
    fireEvent.click(screen.getByRole('button', { name: /^lock$/i }))
    expect(session().locked).toBe(true)
    expect(logEvent).toHaveBeenCalledWith('till.locked', { reason: 'manual', minutes: 5 }, { severity: 0 })
  })

  // ── Sign out ───────────────────────────────────────────────────────────────
  it('Sign out tells the server first (token still attached), then clears the session', async () => {
    let tokenWhenServerWasTold
    mockSignOut.mockImplementation(async () => { tokenWhenServerWasTold = getStaffSession()?.token; markReached() })
    renderNav()

    fireEvent.click(screen.getByRole('button', { name: /^sign out$/i }))

    await waitFor(() => expect(session().activeStaff).toBeNull())
    expect(mockSignOut).toHaveBeenCalledTimes(1)
    expect(mockSignOut).toHaveBeenCalledWith('sign_out')
    expect(tokenWhenServerWasTold).toBe('tok-1')
    expect(getStaffSession()).toBeNull()
    expect(session().locked).toBe(false)
    expect(pings()).toHaveLength(0) // the server's answer to the sign-out was enough
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('Sign out from the mobile More sheet does the same', async () => {
    renderNav()
    fireEvent.click(screen.getByRole('button', { name: /more navigation options/i }))
    fireEvent.click(screen.getAllByRole('button', { name: /^sign out$/i }).at(-1))

    await waitFor(() => expect(session().activeStaff).toBeNull())
    expect(mockSignOut).toHaveBeenCalledWith('sign_out')
  })

  it('covers the till while signing out and ignores a second tap', async () => {
    let finish
    mockSignOut.mockReturnValue(new Promise(resolve => { finish = () => { markReached(); resolve() } }))
    renderNav()

    fireEvent.click(screen.getByRole('button', { name: /^sign out$/i }))
    expect(await screen.findByText(/signing out/i)).toBeInTheDocument()
    expect(session().activeStaff).toEqual(ALICE) // not yet

    fireEvent.click(screen.getByRole('button', { name: /^sign out$/i }))
    expect(mockSignOut).toHaveBeenCalledTimes(1)

    await act(async () => { finish() })
    await waitFor(() => expect(session().activeStaff).toBeNull())
  })

  // ── Never sign out into a login nobody can pass ────────────────────────────
  it('does NOT sign out if the server never answers (3 second limit) — says to use Lock instead', async () => {
    vi.useFakeTimers()
    mockSignOut.mockReturnValue(new Promise(() => {}))
    renderNav()

    fireEvent.click(screen.getByRole('button', { name: /^sign out$/i }))
    await act(async () => { await vi.advanceTimersByTimeAsync(2_999) })
    expect(session().activeStaff).toEqual(ALICE)
    expect(screen.getByText(/signing out/i)).toBeInTheDocument()

    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(session().activeStaff).toEqual(ALICE) // still signed in: the till keeps working
    expect(screen.queryByText(/signing out/i)).not.toBeInTheDocument() // and is not left covered
    expect(lastToast()).toMatch(/reach the server/i)
    expect(lastToast()).toMatch(/lock/i)
    expect(serverUnreachable()).toBe(true) // remembered: no auto-lock until the server is back
  })

  it('does not sign out when the sign-out fails at once and nothing answers (broadband down, Wi-Fi up)', async () => {
    mockSignOut.mockImplementation(noAnswer) // signOutStaff never rejects, even with no server
    mockRpc.mockImplementation(noAnswer)
    renderNav()

    fireEvent.click(screen.getByRole('button', { name: /^sign out$/i }))

    await waitFor(() => expect(lastToast()).toMatch(/reach the server/i))
    expect(session().activeStaff).toEqual(ALICE)
    expect(pings()).toHaveLength(1) // it asked once more before giving up
    expect(serverUnreachable()).toBe(true)
    expect(screen.queryByText(/signing out/i)).not.toBeInTheDocument()
  })

  it('with no server session to end (after an unchecked carry-on) it asks the server outright, and signs out when it answers', async () => {
    setStaffSession(null)
    mockSignOut.mockImplementation(noAnswer) // nothing to tell the server, so nothing was sent
    renderNav()

    fireEvent.click(screen.getByRole('button', { name: /^sign out$/i }))

    await waitFor(() => expect(session().activeStaff).toBeNull())
    expect(pings()).toHaveLength(1)
  })

  it('refuses to sign out while offline (nobody could sign back in) and says to lock instead', () => {
    setNavigatorOnline(false)
    renderNav()

    fireEvent.click(screen.getByRole('button', { name: /^sign out$/i }))

    expect(session().activeStaff).toEqual(ALICE)
    expect(getStaffSession()?.token).toBe('tok-1')
    expect(mockSignOut).not.toHaveBeenCalled()
    expect(lastToast()).toMatch(/offline/i)
    expect(lastToast()).toMatch(/lock/i)
  })

  it('refuses to sign out while the server is known to be unreachable, though the browser says online', async () => {
    markUnreachable() // a PIN check at the lock screen got no answer
    mockRpc.mockImplementation(noAnswer)
    renderNav()

    fireEvent.click(screen.getByRole('button', { name: /^sign out$/i }))

    expect(session().activeStaff).toEqual(ALICE)
    expect(getStaffSession()?.token).toBe('tok-1')
    expect(mockSignOut).not.toHaveBeenCalled()
    expect(screen.queryByText(/signing out/i)).not.toBeInTheDocument()
    expect(lastToast()).toMatch(/reach the server/i)
    expect(lastToast()).toMatch(/lock/i)
    // it does look again, in case the server is back
    await waitFor(() => expect(pings()).toHaveLength(1))
    expect(serverUnreachable()).toBe(true)
    expect(session().activeStaff).toEqual(ALICE)
  })

  it('signs out again once the server has answered', async () => {
    markUnreachable()
    renderNav()

    fireEvent.click(screen.getByRole('button', { name: /^sign out$/i })) // refused; the look-again gets an answer
    expect(session().activeStaff).toEqual(ALICE)
    await waitFor(() => expect(serverUnreachable()).toBe(false))

    fireEvent.click(screen.getByRole('button', { name: /^sign out$/i }))
    await waitFor(() => expect(session().activeStaff).toBeNull())
    expect(mockSignOut).toHaveBeenCalledWith('sign_out')
  })

  // ── Davey mode ─────────────────────────────────────────────────────────────
  it('logs app.davey_mode when the easter egg is triggered', () => {
    renderNav()
    fireEvent.click(screen.getByRole('button', { name: /davey mode/i }))
    expect(screen.getByTestId('davey-mode')).toBeInTheDocument()
    expect(logEvent).toHaveBeenCalledTimes(1)
    expect(logEvent).toHaveBeenCalledWith('app.davey_mode')
  })

  it('logs it from the mobile More sheet as well', () => {
    renderNav()
    fireEvent.click(screen.getByRole('button', { name: /more navigation options/i }))
    fireEvent.click(screen.getByRole('button', { name: /^davey$/i }))
    expect(logEvent).toHaveBeenCalledWith('app.davey_mode')
  })

  // ── Overdue tabs ───────────────────────────────────────────────────────────
  it('badges the Tabs link with the number of overdue tabs', async () => {
    renderNav()
    await waitFor(() => {
      expect(screen.getAllByLabelText('2 overdue tabs').length).toBeGreaterThan(0)
    })
  })
})
