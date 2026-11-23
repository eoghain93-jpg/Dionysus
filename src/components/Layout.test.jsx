import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, cleanup, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Link } from 'react-router-dom'

const { mockInit, mockStop, mockSignIn, mockVerify, mockFrom } = vi.hoisted(() => ({
  mockInit: vi.fn(),
  mockStop: vi.fn(),
  mockSignIn: vi.fn(),
  mockVerify: vi.fn(),
  mockFrom: vi.fn(),
}))

vi.mock('../lib/sync', () => ({ initConnectivityListener: mockInit }))
vi.mock('../lib/supabase', () => ({
  supabase: { from: mockFrom, functions: { invoke: vi.fn() } },
}))
vi.mock('../lib/audit/staff', () => ({
  signInStaff: mockSignIn,
  verifyStaffPin: mockVerify,
  signOutStaff: vi.fn(),
  setStaffPin: vi.fn(),
}))
vi.mock('../lib/audit/log', () => ({ logEvent: vi.fn() }))
vi.mock('./till/SwitchUserModal', () => ({ default: () => null }))

import Layout from './Layout'
import { useSessionStore } from '../stores/sessionStore'
import { useSyncStore } from '../stores/syncStore'
import { logEvent } from '../lib/audit/log'

const ALICE = { id: 'staff-1', name: 'Alice' }
const STAFF = [
  { id: 'staff-1', name: 'Alice', membership_tier: 'staff' },
  { id: 'staff-2', name: 'Bob', membership_tier: 'staff' },
]

function App({ initialPath = '/' }) {
  return (
    <MemoryRouter initialEntries={[initialPath]}>
      <Layout>
        <Routes>
          <Route path="/" element={<div>Till page <Link to="/reports">Go to reports</Link></div>} />
          <Route path="/reports" element={<div>Reports page <Link to="/">Go to till</Link></div>} />
          <Route path="/settings" element={<div>Settings page</div>} />
        </Routes>
      </Layout>
    </MemoryRouter>
  )
}

function enterPin(pin = '1234') {
  for (const d of pin) fireEvent.click(screen.getByRole('button', { name: d }))
}

const pageViews = () => logEvent.mock.calls.filter(c => c[0] === 'page.viewed')
const session = () => useSessionStore.getState()

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  mockInit.mockReturnValue(mockStop)
  useSessionStore.setState({ activeStaff: null, locked: false })
  mockFrom.mockReturnValue({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: STAFF, error: null }),
  })
})

afterEach(() => {
  cleanup() // unmount before the store is reset
  useSessionStore.setState({ activeStaff: null, locked: false })
})

describe('Layout — the whole app is behind a staff sign-in', () => {
  it.each(['/', '/reports', '/settings'])('with nobody signed in, %s shows only the PIN login', async (path) => {
    render(<App initialPath={path} />)

    expect(screen.getByRole('heading', { name: /who.s on the bar/i })).toBeInTheDocument()
    // no page content, no navigation, no status bar
    expect(screen.queryByText(/till page|reports page|settings page/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(screen.queryByTestId('till-badge')).not.toBeInTheDocument()
    await screen.findByRole('group', { name: /staff member/i })
  })

  it('opens on the requested route after sign-in, with navigation', async () => {
    mockSignIn.mockResolvedValue({ valid: true, member: ALICE })
    render(<App initialPath="/reports" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Alice' }))
    enterPin('4821')

    expect(await screen.findByText(/reports page/i)).toBeVisible()
    expect(screen.getAllByRole('navigation').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: /stock/i }).length).toBeGreaterThan(0)
    expect(screen.getByTestId('till-badge')).toBeInTheDocument()
  })

  it('goes back behind the PIN login when the session is cleared', async () => {
    useSessionStore.setState({ activeStaff: ALICE })
    render(<App initialPath="/reports" />)
    expect(screen.getByText(/reports page/i)).toBeVisible()

    act(() => session().clearSession())

    expect(screen.queryByText(/reports page/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /who.s on the bar/i })).toBeInTheDocument()
    await screen.findByRole('group', { name: /staff member/i })
  })

  // ── Connectivity + sync must not depend on the gate ────────────────────────
  it('starts the connectivity listener / offline replay even while the gate is closed', async () => {
    useSyncStore.setState({ isOnline: false })
    render(<App />)

    expect(mockInit).toHaveBeenCalledTimes(1)
    expect(useSyncStore.getState().isOnline).toBe(navigator.onLine)
    expect(screen.getByRole('heading', { name: /who.s on the bar/i })).toBeInTheDocument()
    await screen.findByRole('group', { name: /staff member/i })
  })

  it('does not restart it when someone signs in, locks or signs out', async () => {
    render(<App />)
    await screen.findByRole('group', { name: /staff member/i })
    act(() => session().setActiveStaff(ALICE))
    act(() => session().lock())
    act(() => session().unlock())
    act(() => session().clearSession())

    expect(mockInit).toHaveBeenCalledTimes(1)
    expect(mockStop).not.toHaveBeenCalled()
    await screen.findByRole('group', { name: /staff member/i })
  })

  it('stops it when the layout itself goes away (device signed out)', () => {
    useSessionStore.setState({ activeStaff: ALICE })
    const { unmount } = render(<App />)
    unmount()
    expect(mockStop).toHaveBeenCalledTimes(1)
  })
})

describe('Layout — page views', () => {
  it('logs the first page once someone is signed in, and every route change after', () => {
    useSessionStore.setState({ activeStaff: ALICE })
    render(<App initialPath="/" />)
    expect(pageViews()).toEqual([['page.viewed', { path: '/' }]])

    fireEvent.click(screen.getByRole('link', { name: /go to reports/i }))
    expect(screen.getByText(/reports page/i)).toBeVisible()
    fireEvent.click(screen.getByRole('link', { name: /go to till/i }))

    expect(pageViews()).toEqual([
      ['page.viewed', { path: '/' }],
      ['page.viewed', { path: '/reports' }],
      ['page.viewed', { path: '/' }],
    ])
  })

  it('logs nothing while nobody is signed in (no page is shown), then the page on sign-in', async () => {
    mockSignIn.mockResolvedValue({ valid: true, member: ALICE })
    render(<App initialPath="/reports" />)
    const picker = await screen.findByRole('group', { name: /staff member/i })
    expect(pageViews()).toHaveLength(0)

    fireEvent.click(within(picker).getByRole('button', { name: 'Alice' }))
    enterPin()
    await screen.findByText(/reports page/i)

    await waitFor(() => expect(pageViews()).toEqual([['page.viewed', { path: '/reports' }]]))
  })

  it('logs the page again for whoever takes over the till', () => {
    useSessionStore.setState({ activeStaff: ALICE })
    render(<App initialPath="/reports" />)
    act(() => session().setActiveStaff({ id: 'staff-2', name: 'Bob' }))
    expect(pageViews()).toEqual([
      ['page.viewed', { path: '/reports' }],
      ['page.viewed', { path: '/reports' }],
    ])
  })

  it('does not log the same page again when the same person unlocks', async () => {
    mockVerify.mockResolvedValue({ valid: true })
    useSessionStore.setState({ activeStaff: ALICE })
    render(<App initialPath="/reports" />)
    act(() => session().lock())
    expect(screen.getByText(/reports page/i)).not.toBeVisible()
    enterPin()
    await waitFor(() => expect(session().locked).toBe(false))

    expect(pageViews()).toEqual([['page.viewed', { path: '/reports' }]])
  })

  it('logs the same page again after a sign-out and a new sign-in', () => {
    useSessionStore.setState({ activeStaff: ALICE })
    render(<App initialPath="/reports" />)
    act(() => session().clearSession())
    act(() => session().setActiveStaff(ALICE))
    expect(pageViews()).toHaveLength(2)
  })
})
