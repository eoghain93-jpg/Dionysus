import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const { mockSignOut } = vi.hoisted(() => ({ mockSignOut: vi.fn() }))

vi.mock('./till/SwitchUserModal', () => ({
  default: () => null,
}))
vi.mock('./ui/DaveyMode', () => ({
  default: () => <div data-testid="davey-mode" />,
}))
vi.mock('../lib/audit/staff', () => ({ signOutStaff: mockSignOut }))
vi.mock('../lib/audit/log', () => ({ logEvent: vi.fn() }))

import NavBar from './NavBar'
import { useSessionStore } from '../stores/sessionStore'
import { useToastStore } from '../hooks/useToast'
import { setStaffSession, getStaffSession } from '../lib/audit/staffSession'
import { logEvent } from '../lib/audit/log'

const ALICE = { id: 'staff-1', name: 'Alice' }

function setNavigatorOnline(value) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => value })
}

function renderNav() {
  return render(<MemoryRouter><NavBar /></MemoryRouter>)
}

const session = () => useSessionStore.getState()

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  setNavigatorOnline(true)
  useSessionStore.setState({ activeStaff: ALICE, locked: false })
  useToastStore.setState({ toasts: [] })
  setStaffSession({ id: 'sess-1', token: 'tok-1', staffId: 'staff-1', trust: 'pin' })
  mockSignOut.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup() // unmount before the store is reset
  vi.useRealTimers()
  setNavigatorOnline(true)
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
  it('Lock locks the till, keeps the person signed in, and logs it as manual', () => {
    renderNav()
    fireEvent.click(screen.getByRole('button', { name: /lock till/i }))

    expect(session().locked).toBe(true)
    expect(session().activeStaff).toEqual(ALICE)
    expect(getStaffSession()?.id).toBe('sess-1') // the server session carries on
    expect(logEvent).toHaveBeenCalledTimes(1)
    expect(logEvent).toHaveBeenCalledWith('till.locked', { reason: 'manual', minutes: 5 }, { severity: 0 })
    expect(mockSignOut).not.toHaveBeenCalled()
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
    mockSignOut.mockImplementation(async () => { tokenWhenServerWasTold = getStaffSession()?.token })
    renderNav()

    fireEvent.click(screen.getByRole('button', { name: /^sign out$/i }))

    await waitFor(() => expect(session().activeStaff).toBeNull())
    expect(mockSignOut).toHaveBeenCalledTimes(1)
    expect(mockSignOut).toHaveBeenCalledWith('sign_out')
    expect(tokenWhenServerWasTold).toBe('tok-1')
    expect(getStaffSession()).toBeNull()
    expect(session().locked).toBe(false)
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
    mockSignOut.mockReturnValue(new Promise(resolve => { finish = resolve }))
    renderNav()

    fireEvent.click(screen.getByRole('button', { name: /^sign out$/i }))
    expect(await screen.findByText(/signing out/i)).toBeInTheDocument()
    expect(session().activeStaff).toEqual(ALICE) // not yet

    fireEvent.click(screen.getByRole('button', { name: /^sign out$/i }))
    expect(mockSignOut).toHaveBeenCalledTimes(1)

    await act(async () => { finish() })
    await waitFor(() => expect(session().activeStaff).toBeNull())
  })

  it('still signs out if the server never answers (3 second limit)', async () => {
    vi.useFakeTimers()
    mockSignOut.mockReturnValue(new Promise(() => {}))
    renderNav()

    fireEvent.click(screen.getByRole('button', { name: /^sign out$/i }))
    await act(async () => { await vi.advanceTimersByTimeAsync(2_999) })
    expect(session().activeStaff).toEqual(ALICE)

    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(session().activeStaff).toBeNull()
    expect(getStaffSession()).toBeNull()
  })

  it('refuses to sign out while offline (nobody could sign back in) and says to lock instead', () => {
    setNavigatorOnline(false)
    renderNav()

    fireEvent.click(screen.getByRole('button', { name: /^sign out$/i }))

    expect(session().activeStaff).toEqual(ALICE)
    expect(getStaffSession()?.token).toBe('tok-1')
    expect(mockSignOut).not.toHaveBeenCalled()
    expect(useToastStore.getState().toasts.at(-1)?.message).toMatch(/offline/i)
    expect(useToastStore.getState().toasts.at(-1)?.message).toMatch(/lock/i)
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
})
