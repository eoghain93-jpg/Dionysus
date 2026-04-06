import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { ShoppingCart, Package, Users, BarChart2, Tag, Receipt, ArrowLeftRight, Settings } from 'lucide-react'
import { useSessionStore } from '../stores/sessionStore'
import SwitchUserModal from './till/SwitchUserModal'

const links = [
  { to: '/', label: 'Till', Icon: ShoppingCart },
  { to: '/stock', label: 'Stock', Icon: Package },
  { to: '/members', label: 'Members', Icon: Users },
  { to: '/tabs', label: 'Tabs', Icon: Receipt },
  { to: '/promos', label: 'Promos', Icon: Tag },
  { to: '/reports', label: 'Reports', Icon: BarChart2 },
  { to: '/settings', label: 'Settings', Icon: Settings },
]

export default function NavBar() {
  const { activeStaff } = useSessionStore()
  const [showSwitch, setShowSwitch] = useState(false)

  function initials(name) {
    return name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() ?? '?'
  }

  return (
    <>
      {/* Sidebar — tablet/desktop */}
      <nav className="hidden md:flex flex-col w-20 lg:w-52 bg-slate-900 border-r border-slate-800 p-3 gap-1 shrink-0">
        <div className="px-3 py-5 hidden lg:block">
          <span className="text-white font-bold text-lg" style={{ fontFamily: "'Playfair Display SC', serif" }}>
            Dionysus
          </span>
        </div>
        {links.map(({ to, label, Icon }) => (
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
            <Icon size={20} aria-hidden="true" />
            <span className="hidden lg:block">{label}</span>
          </NavLink>
        ))}
        {activeStaff && (
          <div className="mt-auto pt-3 border-t border-slate-800">
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
          </div>
        )}
      </nav>

      {/* Bottom tab bar — mobile */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-slate-900 border-t border-slate-800 flex z-50">
        {links.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center gap-1 py-3 text-xs font-medium
               transition-colors duration-200 cursor-pointer min-h-[56px]
               ${isActive ? 'text-blue-400' : 'text-slate-500'}`
            }
            aria-label={label}
          >
            <Icon size={22} aria-hidden="true" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

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

      {showSwitch && <SwitchUserModal onClose={() => setShowSwitch(false)} />}
    </>
  )
}
