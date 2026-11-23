import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import NavBar from './NavBar'
import StatusBar from './StatusBar'
import StaffGate from './StaffGate'
import Toast from './ui/Toast'
import { initConnectivityListener } from '../lib/sync'
import { logEvent } from '../lib/audit/log'
import { useSyncStore } from '../stores/syncStore'
import { useSessionStore } from '../stores/sessionStore'

export default function Layout({ children }) {
  const setOnline = useSyncStore(s => s.setOnline)
  const { pathname } = useLocation()
  const staffId = useSessionStore(s => s.activeStaff?.id ?? null)
  const locked = useSessionStore(s => s.locked)

  // Connectivity + the offline replay belong to the till, not to whoever is
  // signed in: they run here, OUTSIDE the StaffGate, so queued sales keep
  // being sent while the PIN login or the lock screen is showing.
  useEffect(() => {
    setOnline(navigator.onLine)
    return initConnectivityListener()
  }, [setOnline])

  // The one place page views are logged: every route a signed-in person is
  // shown, including the first after signing in (and again for whoever
  // takes over the till on that page). With nobody signed in the gate shows
  // only the PIN login, and while locked only the lock screen, so no page
  // has been viewed and none is recorded until someone can actually see it.
  const lastViewed = useRef(null)
  useEffect(() => {
    if (!staffId) { lastViewed.current = null; return }
    if (locked) return
    const view = `${staffId} ${pathname}`
    if (lastViewed.current === view) return // unlocked on the page already recorded
    lastViewed.current = view
    logEvent('page.viewed', { path: pathname })
  }, [pathname, staffId, locked])

  return (
    <StaffGate>
      <div className="flex h-screen overflow-hidden bg-[#121314] flex-col">
        <StatusBar />
        <div className="flex flex-1 overflow-hidden">
          <NavBar />
          <main className="flex-1 overflow-auto pb-20 md:pb-0">
            {children}
          </main>
        </div>
        <Toast />
      </div>
    </StaffGate>
  )
}
