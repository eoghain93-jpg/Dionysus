import { useState, useEffect } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { ShoppingCart, Package, Users, BarChart2, Tag, Receipt, Settings, MoreHorizontal, X, UserPlus } from 'lucide-react'
import { useSessionStore } from '../stores/sessionStore'
import { useTabAlertStore } from '../stores/tabAlertStore'
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

export default function NavBar() {
  const { activeStaff } = useSessionStore()
  const [showSwitch, setShowSwitch] = useState(false)
  const [showMore, setShowMore] = useState(false)
  const [showDavey, setShowDavey] = useState(false)
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
              `w-[72px] min-h-[62px] flex flex-col items-center justify-center gap-1 rounded-2xl text-[13px]
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
          <div className="mt-auto pt-3 flex flex-col items-center gap-1">
            <button
              onClick={() => setShowDavey(true)}
              className="w-[72px] min-h-[56px] flex flex-col items-center justify-center gap-1 rounded-2xl text-[13px] font-semibold
                text-slate-400 hover:bg-slate-800 hover:text-white transition-colors duration-200 cursor-pointer
                focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label="Davey mode"
            >
              <StripesIcon size={20} />
              <span>Davey</span>
            </button>
            <button
              onClick={() => setShowSwitch(true)}
              className="w-[72px] min-h-[68px] flex flex-col items-center justify-center gap-1 rounded-2xl text-[13px] font-semibold
                border border-slate-700 text-slate-100 hover:bg-slate-800 transition-colors duration-200 cursor-pointer
                focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label="Switch user"
            >
              <span className="w-[30px] h-[30px] rounded-full bg-slate-100 text-[#121314] flex items-center justify-center text-[13px] font-extrabold shrink-0">
                {initials(activeStaff.name)}
              </span>
              <span className="max-w-full px-1 truncate">{activeStaff.name.split(' ')[0]}</span>
            </button>
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
              <button
                onClick={() => { setShowMore(false); setShowDavey(true) }}
                className="w-full flex items-center gap-3 px-4 py-4 text-sm font-medium transition-colors duration-150
                  text-slate-300 hover:bg-slate-700 hover:text-white cursor-pointer"
              >
                <StripesIcon size={18} />
                Davey
              </button>
            )}
          </div>
        </>
      )}

      {showSwitch && <SwitchUserModal onClose={() => setShowSwitch(false)} />}
      {showDavey && <DaveyMode onClose={() => setShowDavey(false)} />}
    </>
  )
}
