import { useState, useEffect } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { ShoppingCart, Package, Users, BarChart2, Tag, Receipt, Settings, MoreHorizontal, X, UserPlus, ScrollText, Lock, LogOut } from 'lucide-react'
import { useSessionStore } from '../stores/sessionStore'
import { useToastStore } from '../hooks/useToast'
import { useTabAlertStore } from '../stores/tabAlertStore'
import { lockTill } from '../hooks/useIdleLock'
import { logEvent } from '../lib/audit/log'
import { serverUnreachable, markUnreachable, answersSeen } from '../lib/audit/reachability'
import { getStaffSession, setStaffSession } from '../lib/audit/staffSession'
import SwitchUserModal from './till/SwitchUserModal'
import DaveyMode from './ui/DaveyMode'

const allLinks = [
  { to: '/', label: 'Till', Icon: ShoppingCart },
  { to: '/stock', label: 'Stock', Icon: Package },
  { to: '/members', label: 'Members', Icon: Users },
  { to: '/tabs', label: 'Tabs', Icon: Receipt },
  { to: '/reports', label: 'Reports', Icon: BarChart2 },
  { to: '/promos', label: 'Promos', Icon: Tag },
  { to: '/guests', label: 'Guests', Icon: UserPlus },
  { to: '/log', label: 'Log', Icon: ScrollText },
  { to: '/settings', label: 'Settings', Icon: Settings },
]

// Primary nav: max 5 items for bottom bar
const primaryLinks = allLinks.slice(0, 5)
const moreLinks = allLinks.slice(5)

// Re-check overdue tabs this often while the till sits on one screen.
const TAB_ALERT_REFRESH_MS = 5 * 60 * 1000

// Count of tabs that have gone too long without a payment, shown on the
// Tabs link. Hidden when there are none.
function OverdueBadge({ count }) {
  if (!count) return null
  return (
    <span
      aria-label={`${count} overdue ${count === 1 ? 'tab' : 'tabs'}`}
      className="absolute -top-1.5 -right-2 min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500
        text-slate-900 text-[11px] font-bold leading-[18px] text-center"
    >
      {count}
    </span>
  )
}

// Black-and-white stripes swatch for the Davey mode button
function StripesIcon({ size }) {
  return (
    <span
      aria-hidden="true"
      className="rounded-full border border-slate-500 shrink-0"
      style={{
        width: size,
        height: size,
        background: 'repeating-linear-gradient(90deg, #000 0 4px, #fff 4px 8px)',
      }}
    />
  )
}

// Signing out tells the server first, and only goes ahead once the server has
// answered: a signed-out till needs the server to sign anyone back in, so
// signing out into a dead connection would leave a login nobody can pass.
// A slow connection must not hold the till either: after this long with no
// answer the sign-out is called off and the person is told to use Lock.
const SIGN_OUT_WAIT_MS = 3000

const NO_SERVER_TOAST = 'Can’t reach the server — nobody could sign back in. Use Lock instead.'

// Ask the database anything. The answer itself is not used: the fetch wrapper
// notes that the server answered (lib/audit/reachability.js), and a database
// that has no audit_ping yet still answers. Loaded on demand so the nav bar
// never drags the Supabase client into a module that has no need of it.
async function askServer() {
  try {
    const { supabase } = await import('../lib/supabase')
    await supabase.rpc('audit_ping')
  } catch { /* no answer */ }
}

export default function NavBar() {
  const { activeStaff } = useSessionStore()
  const [showSwitch, setShowSwitch] = useState(false)
  const [showMore, setShowMore] = useState(false)
  const [showDavey, setShowDavey] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const location = useLocation()
  const overdueCount = useTabAlertStore(s => s.overdueCount)
  const refreshTabAlerts = useTabAlertStore(s => s.refresh)

  // Refresh on every screen change (cheap, and catches a tab settled a
  // moment ago) plus a timer for a till left sitting on one screen.
  useEffect(() => {
    refreshTabAlerts()
    const timer = setInterval(refreshTabAlerts, TAB_ALERT_REFRESH_MS)
    return () => clearInterval(timer)
  }, [location.pathname, refreshTabAlerts])

  function openDavey() {
    logEvent('app.davey_mode')
    setShowDavey(true)
  }

  // Lock: the till keeps the open order and shows whose it is; their PIN
  // carries on. It ends their server session (see useIdleLock.lockTill).
  function handleLock() {
    setShowMore(false)
    lockTill('manual')
  }

  async function handleSignOut() {
    if (signingOut) return
    setShowMore(false)
    // Nobody can sign back in without the server (a PIN cannot be checked),
    // so signing out now would leave the till unusable. Lock still works:
    // its screen lets the same person carry on, on the record.
    if (navigator.onLine === false) {
      useToastStore.getState().addToast('Offline — nobody could sign back in. Use Lock instead.', 'error')
      return
    }
    if (serverUnreachable()) {
      useToastStore.getState().addToast(NO_SERVER_TOAST, 'error')
      askServer() // if it is back after all, the next tap goes through
      return
    }
    setSigningOut(true)
    const before = answersSeen()
    const had = getStaffSession()
    const staffId = useSessionStore.getState().activeStaff?.id
    const told = (async () => {
      const { signOutStaff } = await import('../lib/audit/staff')
      await signOutStaff('sign_out') // never rejects; the server records the sign-out
      // No answer to that — or nothing was asked, because no server
      // session was open (after an unchecked carry-on): ask outright.
      if (answersSeen() === before) await askServer()
    })().catch(() => {}) // treated below as no answer
    await Promise.race([told, new Promise(resolve => setTimeout(resolve, SIGN_OUT_WAIT_MS))])
    setSigningOut(false)
    if (answersSeen() === before) {
      // The browser says online but the server did not answer (the usual
      // outage: broadband down, Wi-Fi up). Stay signed in. Remembered, so
      // the till also stops auto-locking until the server is back.
      markUnreachable()
      useToastStore.getState().addToast(NO_SERVER_TOAST, 'error')
      // Staying signed in means keeping the sign-in: the attempt forgets the
      // session token once it gives up, which would leave this person's
      // next actions recorded as unverified. If the server's answer turns
      // up late after all, the session has really ended there, so finish
      // the sign-out they asked for instead.
      told.then(() => {
        const session = useSessionStore.getState()
        if (session.activeStaff?.id !== staffId || getStaffSession()) return // someone has signed in since
        if (answersSeen() !== before) session.clearSession()
        else if (had) setStaffSession(had)
      })
      return
    }
    useSessionStore.getState().clearSession()
  }

  const moreIsActive = moreLinks.some(l => location.pathname === l.to)

  function initials(name) {
    return name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() ?? '?'
  }

  return (
    <>
      {/* Sidebar — tablet/desktop (shows all links) */}
      <nav className="hidden md:flex flex-col items-center w-[88px] bg-slate-950 px-2 pt-4 pb-3 gap-1 shrink-0 overflow-y-auto">
        {allLinks.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `w-[72px] min-h-[62px] [@media(max-height:860px)]:min-h-[54px] shrink-0 flex flex-col items-center justify-center gap-1 rounded-2xl text-[13px]
               transition-colors duration-200 cursor-pointer
               ${isActive
                 ? 'bg-blue-600 text-white font-bold'
                 : 'text-slate-400 font-semibold hover:bg-slate-800 hover:text-white'}`
            }
          >
            <span className="relative flex">
              <Icon size={22} aria-hidden="true" />
              {to === '/tabs' && <OverdueBadge count={overdueCount} />}
            </span>
            <span>{label}</span>
          </NavLink>
        ))}
        {activeStaff && (
          // Pinned to the bottom of the rail: on a short screen the links
          // above scroll, but Lock and Sign out can never be out of reach.
          <div className="mt-auto sticky bottom-0 -mb-3 pt-3 pb-3 bg-slate-950 flex flex-col items-center gap-1">
            <button
              onClick={openDavey}
              className="w-[72px] min-h-[56px] [@media(max-height:860px)]:min-h-[48px] flex flex-col items-center justify-center gap-1 rounded-2xl text-[13px] font-semibold
                text-slate-400 hover:bg-slate-800 hover:text-white transition-colors duration-200 cursor-pointer
                focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label="Davey mode"
            >
              <StripesIcon size={20} />
              <span>Davey</span>
            </button>
            <button
              onClick={() => setShowSwitch(true)}
              className="w-[72px] min-h-[68px] [@media(max-height:860px)]:min-h-[60px] flex flex-col items-center justify-center gap-1 rounded-2xl text-[13px] font-semibold
                border border-slate-700 text-slate-100 hover:bg-slate-800 transition-colors duration-200 cursor-pointer
                focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label="Switch user"
            >
              <span className="w-[30px] h-[30px] rounded-full bg-slate-100 text-[#121314] flex items-center justify-center text-[13px] font-extrabold shrink-0">
                {initials(activeStaff.name)}
              </span>
              <span className="max-w-full px-1 truncate">{activeStaff.name.split(' ')[0]}</span>
            </button>
            {/* Lock + Sign out — side by side so the rail stays short */}
            <div className="w-[72px] flex gap-1">
              <button
                onClick={handleLock}
                title="Lock"
                className="flex-1 min-h-[52px] flex items-center justify-center rounded-2xl
                  border border-slate-700 text-slate-100 hover:bg-slate-800 transition-colors duration-200 cursor-pointer
                  focus:outline-none focus:ring-2 focus:ring-blue-500"
                aria-label="Lock till"
              >
                <Lock size={20} aria-hidden="true" />
              </button>
              <button
                onClick={handleSignOut}
                disabled={signingOut}
                title="Sign out"
                className="flex-1 min-h-[52px] flex items-center justify-center rounded-2xl
                  border border-slate-700 text-slate-100 hover:bg-slate-800 transition-colors duration-200 cursor-pointer
                  focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="Sign out"
              >
                <LogOut size={20} aria-hidden="true" />
              </button>
            </div>
          </div>
        )}
      </nav>

      {/* Bottom tab bar — mobile (5 primary + More) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-slate-900 border-t border-slate-800 flex z-50">
        {primaryLinks.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center gap-1 py-3 text-xs font-medium
               transition-colors duration-200 cursor-pointer min-h-[56px]
               ${isActive ? 'text-blue-400' : 'text-slate-500'}`
            }
          >
            <span className="relative flex">
              <Icon size={22} aria-hidden="true" />
              {to === '/tabs' && <OverdueBadge count={overdueCount} />}
            </span>
            <span>{label}</span>
          </NavLink>
        ))}
        {/* More button */}
        <button
          onClick={() => setShowMore(v => !v)}
          aria-label="More navigation options"
          aria-expanded={showMore}
          className={`flex-1 flex flex-col items-center justify-center gap-1 py-3 text-xs font-medium
            transition-colors duration-200 cursor-pointer min-h-[56px]
            ${moreIsActive || showMore ? 'text-blue-400' : 'text-slate-500'}`}
        >
          {showMore ? <X size={22} aria-hidden="true" /> : <MoreHorizontal size={22} aria-hidden="true" />}
          <span>More</span>
        </button>
      </nav>

      {/* More menu overlay — mobile */}
      {showMore && (
        <>
          <div
            className="md:hidden fixed inset-0 z-40"
            onClick={() => setShowMore(false)}
          />
          <div className="md:hidden fixed bottom-16 right-2 z-50 bg-slate-800 border border-slate-700
            rounded-2xl shadow-xl overflow-hidden min-w-[220px]">
            {activeStaff && (
              <button
                onClick={() => { setShowMore(false); setShowSwitch(true) }}
                aria-label={`Logged in as ${activeStaff.name}. Tap to switch user.`}
                className="w-full flex items-center gap-3 px-4 py-4 text-sm font-bold transition-colors duration-150
                  text-white border-b border-slate-700 hover:bg-slate-700 cursor-pointer"
              >
                <span className="w-7 h-7 rounded-full bg-slate-100 text-[#121314] flex items-center justify-center text-xs font-extrabold shrink-0">
                  {initials(activeStaff.name)}
                </span>
                <span className="flex-1 text-left truncate">{activeStaff.name}</span>
                <span className="text-slate-400 font-semibold">Switch</span>
              </button>
            )}
            {moreLinks.map(({ to, label, Icon }) => (
              <NavLink
                key={to}
                to={to}
                onClick={() => setShowMore(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-4 text-sm font-medium transition-colors duration-150
                   ${isActive ? 'text-blue-400 bg-slate-700' : 'text-slate-300 hover:bg-slate-700 hover:text-white'}`
                }
              >
                <Icon size={18} aria-hidden="true" />
                {label}
              </NavLink>
            ))}
            {activeStaff && (
              <>
                <button
                  onClick={() => { setShowMore(false); openDavey() }}
                  className="w-full flex items-center gap-3 px-4 py-4 text-sm font-medium transition-colors duration-150
                    text-slate-300 hover:bg-slate-700 hover:text-white cursor-pointer"
                >
                  <StripesIcon size={18} />
                  Davey
                </button>
                <button
                  onClick={handleLock}
                  className="w-full flex items-center gap-3 px-4 py-4 text-sm font-medium transition-colors duration-150
                    text-slate-300 hover:bg-slate-700 hover:text-white cursor-pointer border-t border-slate-700"
                >
                  <Lock size={18} aria-hidden="true" />
                  Lock
                </button>
                <button
                  onClick={handleSignOut}
                  disabled={signingOut}
                  className="w-full flex items-center gap-3 px-4 py-4 text-sm font-medium transition-colors duration-150
                    text-slate-300 hover:bg-slate-700 hover:text-white cursor-pointer disabled:opacity-50"
                >
                  <LogOut size={18} aria-hidden="true" />
                  Sign out
                </button>
              </>
            )}
          </div>
        </>
      )}

      {/* Covers the till for the moment it takes the server to answer */}
      {signingOut && (
        <div
          role="status"
          className="fixed inset-0 z-[150] bg-[#121314] flex items-center justify-center text-slate-300 text-base font-semibold"
        >
          Signing out…
        </div>
      )}

      {showSwitch && <SwitchUserModal onClose={() => setShowSwitch(false)} />}
      {showDavey && <DaveyMode onClose={() => setShowDavey(false)} />}
    </>
  )
}
