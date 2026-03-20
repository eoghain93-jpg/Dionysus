import { NavLink } from 'react-router-dom'
import { CreditCard, Wallet, Clock, User } from 'lucide-react'

const links = [
  { to: '/', label: 'My Card', Icon: CreditCard },
  { to: '/tab', label: 'My Tab', Icon: Wallet },
  { to: '/history', label: 'History', Icon: Clock },
  { to: '/account', label: 'Account', Icon: User },
]

export default function BottomNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-slate-800 border-t border-slate-700 flex">
      {links.map(({ to, label, Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            `flex-1 flex flex-col items-center gap-1 py-3 text-xs transition-colors ${
              isActive ? 'text-blue-400' : 'text-slate-500'
            }`
          }
        >
          <Icon size={20} />
          {label}
        </NavLink>
      ))}
    </nav>
  )
}
