import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import DeviceGate from './DeviceGate'
import DeviceLoginScreen from './DeviceLoginScreen'

const { mockGetSession, mockOnAuthStateChange, mockSignIn, mockFrom, syncState } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockOnAuthStateChange: vi.fn(),
  mockSignIn: vi.fn(),
  mockFrom: vi.fn(),
  syncState: { isOnline: true },
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: mockGetSession,
      onAuthStateChange: mockOnAuthStateChange,
      signInWithPassword: mockSignIn,
    },
    from: mockFrom,
  },
}))

vi.mock('../../stores/syncStore', () => ({
  useSyncStore: () => syncState,
}))

vi.mock('../../lib/audit/log', () => ({ logEvent: vi.fn() }))

import { logEvent } from '../../lib/audit/log'

beforeEach(() => {
  vi.clearAllMocks()
  syncState.isOnline = true
  localStorage.clear()
  mockOnAuthStateChange.mockReturnValue({
    data: { subscription: { unsubscribe: vi.fn() } },
  })
})

describe('DeviceGate', () => {
  it('renders children when a cached session exists (normal day at the pub)', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'till-user' } } } })
    render(<DeviceGate><div data-testid="app" /></DeviceGate>)
    expect(await screen.findByTestId('app')).toBeInTheDocument()
  })

  it('shows the device login screen when no session exists (first launch)', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } })
    render(<DeviceGate><div data-testid="app" /></DeviceGate>)
    expect(await screen.findByRole('heading', { name: /connect this till/i })).toBeInTheDocument()
    expect(screen.queryByTestId('app')).not.toBeInTheDocument()
  })

  it('switches to the app when the auth state changes to signed-in', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } })
    let authCallback
    mockOnAuthStateChange.mockImplementation((cb) => {
      authCallback = cb
      return { data: { subscription: { unsubscribe: vi.fn() } } }
    })
    render(<DeviceGate><div data-testid="app" /></DeviceGate>)
    await screen.findByRole('heading', { name: /connect this till/i })

    act(() => authCallback('SIGNED_IN', { user: { id: 'till-user' } }))

    expect(await screen.findByTestId('app')).toBeInTheDocument()
    expect(logEvent).not.toHaveBeenCalled() // DeviceLoginScreen logs the sign-in itself
  })

  it('logs device.signed_out when Supabase reports the device session gone, and shows the device login', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'till-user' } } } })
    let authCallback
    mockOnAuthStateChange.mockImplementation((cb) => {
      authCallback = cb
      return { data: { subscription: { unsubscribe: vi.fn() } } }
    })
    render(<DeviceGate><div data-testid="app" /></DeviceGate>)
    await screen.findByTestId('app')

    act(() => authCallback('SIGNED_OUT', null))

    expect(logEvent).toHaveBeenCalledTimes(1)
    expect(logEvent).toHaveBeenCalledWith('device.signed_out', {}, { severity: 2 })
    expect(await screen.findByRole('heading', { name: /connect this till/i })).toBeInTheDocument()
    expect(screen.queryByTestId('app')).not.toBeInTheDocument()
  })

  it.each(['INITIAL_SESSION', 'TOKEN_REFRESHED', 'SIGNED_IN', 'USER_UPDATED'])('logs nothing for the routine auth event %s', async (event) => {
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'till-user' } } } })
    let authCallback
    mockOnAuthStateChange.mockImplementation((cb) => {
      authCallback = cb
      return { data: { subscription: { unsubscribe: vi.fn() } } }
    })
    render(<DeviceGate><div data-testid="app" /></DeviceGate>)
    await screen.findByTestId('app')

    act(() => authCallback(event, { user: { id: 'till-user' } }))

    expect(logEvent).not.toHaveBeenCalled()
    expect(screen.getByTestId('app')).toBeInTheDocument()
  })
})

describe('DeviceLoginScreen', () => {
  function fillAndSubmit() {
    fireEvent.change(screen.getByLabelText(/device email/i), {
      target: { value: 'till-1@example.com' },
    })
    fireEvent.change(screen.getByLabelText(/device password/i), {
      target: { value: 'secret-pass' },
    })
    fireEvent.click(screen.getByRole('button', { name: /connect till/i }))
  }

  it('signs in with the device credential and stores the till id from till_devices', async () => {
    mockSignIn.mockResolvedValue({ data: { user: { id: 'till-user-1' } }, error: null })
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { till_id: 'till-2' }, error: null }),
    })

    render(<DeviceLoginScreen />)
    fillAndSubmit()

    await waitFor(() => {
      expect(mockSignIn).toHaveBeenCalledWith({
        email: 'till-1@example.com',
        password: 'secret-pass',
      })
      expect(mockFrom).toHaveBeenCalledWith('till_devices')
    })
    expect(localStorage.getItem('tillId')).toBe('till-2')
  })

  it('shows a friendly error for wrong credentials', async () => {
    mockSignIn.mockResolvedValue({
      data: {},
      error: { message: 'Invalid login credentials' },
    })
    render(<DeviceLoginScreen />)
    fillAndSubmit()
    expect(await screen.findByRole('alert')).toHaveTextContent(/wrong email or password/i)
  })

  it('shows an offline notice when the device starts offline', () => {
    syncState.isOnline = false
    render(<DeviceLoginScreen />)
    expect(screen.getByRole('status')).toHaveTextContent(/no connection/i)
  })

  // ── Audit events ───────────────────────────────────────────────────────────
  it('logs device.signed_in on success, after the till id is known', async () => {
    mockSignIn.mockResolvedValue({ data: { user: { id: 'till-user-1' } }, error: null })
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { till_id: 'till-2' }, error: null }),
    })
    let tillIdWhenLogged
    logEvent.mockImplementation(() => { tillIdWhenLogged = localStorage.getItem('tillId') })

    render(<DeviceLoginScreen />)
    fillAndSubmit()

    await waitFor(() => expect(logEvent).toHaveBeenCalled())
    expect(logEvent).toHaveBeenCalledTimes(1)
    expect(logEvent).toHaveBeenCalledWith('device.signed_in', {}, { severity: 1 })
    expect(tillIdWhenLogged).toBe('till-2')
    logEvent.mockReset()
  })

  it('still logs device.signed_in when the device has no till_devices row', async () => {
    mockSignIn.mockResolvedValue({ data: { user: { id: 'till-user-1' } }, error: null })
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    })
    render(<DeviceLoginScreen />)
    fillAndSubmit()
    await waitFor(() => expect(logEvent).toHaveBeenCalledWith('device.signed_in', {}, { severity: 1 }))
    expect(logEvent).toHaveBeenCalledTimes(1)
  })

  it('logs device.sign_in_failed with the message and the email — never the password', async () => {
    mockSignIn.mockResolvedValue({ data: {}, error: { message: 'Invalid login credentials' } })
    render(<DeviceLoginScreen />)
    fillAndSubmit()
    await screen.findByRole('alert')

    expect(logEvent).toHaveBeenCalledTimes(1)
    expect(logEvent).toHaveBeenCalledWith(
      'device.sign_in_failed',
      { message: 'Invalid login credentials', email: 'till-1@example.com' },
      { severity: 2 },
    )
    expect(JSON.stringify(logEvent.mock.calls)).not.toContain('secret-pass')
  })

  it('logs device.sign_in_failed when the sign-in request itself throws', async () => {
    mockSignIn.mockRejectedValue(new Error('Failed to fetch'))
    render(<DeviceLoginScreen />)
    fillAndSubmit()
    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to fetch/i)

    expect(logEvent).toHaveBeenCalledTimes(1)
    expect(logEvent).toHaveBeenCalledWith(
      'device.sign_in_failed',
      { message: 'Failed to fetch', email: 'till-1@example.com' },
      { severity: 2 },
    )
    expect(JSON.stringify(logEvent.mock.calls)).not.toContain('secret-pass')
  })

  it('a failed till lookup AFTER a good sign-in is not logged as a failed sign-in', async () => {
    mockSignIn.mockResolvedValue({ data: { user: { id: 'till-user-1' } }, error: null })
    mockFrom.mockImplementation(() => { throw new Error('lookup blew up') })
    render(<DeviceLoginScreen />)
    fillAndSubmit()
    await screen.findByRole('alert')

    expect(logEvent).toHaveBeenCalledTimes(1)
    expect(logEvent).toHaveBeenCalledWith('device.signed_in', {}, { severity: 1 })
    mockFrom.mockReset()
  })
})
