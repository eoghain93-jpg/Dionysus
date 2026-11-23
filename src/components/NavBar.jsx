import { useState, useEffect } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { ShoppingCart, Package, Users, BarChart2, Tag, Receipt, ArrowLeftRight, Settings, MoreHorizontal, X, UserPlus, ScrollText, Lock, LogOut } from 'lucide-react'
import { useSessionStore } from '../stores/sessionStore'
import { useToastStore } from '../hooks/useToast'
import { useTabAlertStore } from '../stores/tabAlertStore'
import { lockTill } from '../hooks/useIdleLock'
import { logEvent } from '../lib/audit/log'
import { serverUnreachable, markUnreachable, answersSeen } from '../lib/audit/reachability'
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
    try {
      await Promise.race([
        (async () => {
          const { signOutStaff } = await import('../lib/audit/staff')
          await signOutStaff('sign_out') // never rejects; the server records the sign-out
          // No answer to that — or nothing was asked, because no server
          // session was open (after an unchecked carry-on): ask outright.
          if (answersSeen() === before) await askServer()
        })(),
        new Promise(resolve => setTimeout(resolve, SIGN_OUT_WAIT_MS)),
      ])
    } catch {
      // treated below as no answer
    }
    setSigningOut(false)
    if (answersSeen() === before) {
      // The browser says online but the server did not answer (the usual
      // outage: broadband down, Wi-Fi up). Stay signed in. Remembered, so
      // the till also stops auto-locking until the server is back.
      markUnreachable()
      useToastStore.getState().addToast(NO_SERVER_TOAST, 'error')
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
      <nav className="hidden md:flex flex-col w-20 lg:w-52 bg-slate-900 border-r border-slate-800 p-3 gap-1 shrink-0 overflow-y-auto">
        <div className="px-1 py-3 hidden lg:flex justify-center">
          <img src="/fairmile-logo.png" alt="The Fairmile Pub & Kitchen"
            className="w-28 h-auto" />
        </div>
        {allLinks.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium
               transition-colors duration-200 cursor-pointer min-h-[44px]
               ${isActive
                 ? 'bg-blue-600 text-white'
                 : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`
            }
          >
            <span className="relative flex">
              <Icon size={20} aria-hidden="true" />
              {to === '/tabs' && <OverdueBadge count={overdueCount} />}
            </span>
            <span className="hidden lg:block">{label}</span>
          </NavLink>
        ))}
        {activeStaff && (
          <div className="mt-auto pt-3 border-t border-slate-800 flex flex-col gap-1">
            <button
              onClick={openDavey}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium
                text-slate-400 hover:bg-slate-800 hover:text-white transition-colors duration-200 cursor-pointer
                focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label="Davey mode"
            >
              <StripesIcon size={20} />
              <span className="hidden lg:block">Davey</span>
            </button>
            <button
              onClick={() => setShowSwitch(true)}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium
                text-slate-400 hover:bg-slate-800 hover:text-white transition-colors duration-200 cursor-pointer
                focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label="Switch user"
            >
              <span className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
                {initials(activeStaff.name)}
              </span>
              <span className="hidden lg:block truncate flex-1 text-left">{activeStaff.name}</span>
              <ArrowLeftRight size={14} className="hidden lg:block shrink-0" aria-hidden="true" />
            </button>
            {/* Lock + Sign out — one compact row on wide sidebars, stacked icons on narrow */}
            <div className="flex flex-col lg:flex-row gap-1">
              <button
                onClick={handleLock}
                className="flex-1 flex items-center justify-center gap-2 px-2 py-3 rounded-xl text-xs font-medium min-h-[44px]
                  text-slate-400 hover:bg-slate-800 hover:text-white transition-colors duration-200 cursor-pointer
                  focus:outline-none focus:ring-2 focus:ring-blue-500"
                aria-label="Lock till"
              >
                <Lock size={18} className="shrink-0" aria-hidden="true" />
                <span className="hidden lg:block">Lock</span>
              </button>
              <button
                onClick={handleSignOut}
                disabled={signingOut}
                className="flex-1 flex items-center justify-center gap-2 px-2 py-3 rounded-xl text-xs font-medium min-h-[44px]
                  text-slate-400 hover:bg-slate-800 hover:text-white transition-colors duration-200 cursor-pointer
                  focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="Sign out"
              >
                <LogOut size={18} className="shrink-0" aria-hidden="true" />
                <span className="hidden lg:block whitespace-nowrap">Sign out</span>
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
            rounded-2xl shadow-xl overflow-hidden min-w-[160px]">
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

      {activeStaff && (
        <button
          onClick={() => setShowSwitch(true)}
          aria-label={`Logged in as ${activeStaff.name}. Tap to switch user.`}
          className="md:hidden fixed top-8 right-3 z-40 w-11 h-11 rounded-full bg-blue-600 hover:bg-blue-500
            flex items-center justify-center text-white text-sm font-bold shadow-lg cursor-pointer
            focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
        >
          {initials(activeStaff.name)}
        </button>
      )}

      {/* Covers the till for the moment it takes the server to answer */}
      {signingOut && (
        <div
          role="status"
          className="fixed inset-0 z-[150] bg-slate-900 flex items-center justify-center text-slate-400 text-sm"
        >
          Signing out…
        </div>
      )}

      {showSwitch && <SwitchUserModal onClose={() => setShowSwitch(false)} />}
      {showDavey && <DaveyMode onClose={() => setShowDavey(false)} />}
    </>
  )
}
