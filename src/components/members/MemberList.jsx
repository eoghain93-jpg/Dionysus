import { Clock, Pencil } from '../../lib/icons'

/**
 * Returns true if the member's renewal_date is within 30 days of today.
 */
export function isRenewalDueSoon(renewal_date) {
  if (!renewal_date) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const renewal = new Date(renewal_date)
  renewal.setHours(0, 0, 0, 0)
  const diffMs = renewal - today
  const diffDays = diffMs / (1000 * 60 * 60 * 24)
  return diffDays >= 0 && diffDays <= 30
}

/**
 * Renders a searchable list of members.
 * Props:
 *   members  — array of member objects
 *   onSelect — called with member when row clicked
 *   onEdit   — called with member when Edit button clicked
 */
export default function MemberList({ members, onSelect, onEdit }) {
  if (members.length === 0) {
    return (
      <p className="text-slate-400 text-sm p-6 text-center">No members found.</p>
    )
  }

  return (
    <ul role="list" className="divide-y divide-slate-700">
      {members.map(member => {
        const renewalSoon = isRenewalDueSoon(member.renewal_date)
        const hasTab = member.tab_balance > 0

        return (
          <li key={member.id} className="flex items-center gap-3 px-4 py-3 hover:bg-[#1E293B] transition-colors">
            {/* Clickable main area */}
            <button
              onClick={() => onSelect(member)}
              className="flex-1 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 text-left cursor-pointer min-h-[44px] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617] rounded"
              aria-label={`View profile for ${member.name}`}
            >
              {/* Name + membership number */}
              <div className="flex-1 min-w-0">
                <p className="text-white font-medium truncate">{member.name}</p>
                <p className="text-slate-400 text-xs">{member.membership_number}</p>
              </div>

              {/* Tier badge */}
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-700 text-slate-300 capitalize shrink-0">
                {member.membership_tier ?? 'member'}
              </span>

              {/* Tab balance */}
              {hasTab && (
                <span className="text-blue-400 text-sm font-medium shrink-0">
                  Tab: £{Number(member.tab_balance).toFixed(2)}
                </span>
              )}

              {/* Renewal alert — icon + text, never colour alone */}
              {renewalSoon && (
                <span className="inline-flex items-center gap-1 text-amber-400 text-xs shrink-0" aria-label="Renewal due soon">
                  <Clock size={14} aria-hidden="true" />
                  <span>Renewal due</span>
                </span>
              )}
            </button>

            {/* Edit button */}
            <button
              onClick={e => { e.stopPropagation(); onEdit(member) }}
              aria-label={`Edit ${member.name}`}
              className="text-slate-400 hover:text-white transition-colors cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617] shrink-0"
            >
              <Pencil size={16} aria-hidden="true" />
            </button>
          </li>
        )
      })}
    </ul>
  )
}
