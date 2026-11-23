import { Clock, Pencil, Lock } from '../../lib/icons'
import BlurredAmount from '../ui/BlurredAmount'

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
      <p className="ui-empty">No members found.</p>
    )
  }

  return (
    <ul role="list" className="divide-y divide-slate-800">
      {members.map(member => {
        const renewalSoon = isRenewalDueSoon(member.renewal_date)
        const hasTab = member.tab_balance > 0

        return (
          <li key={member.id} className="flex items-center gap-2 pl-4 pr-2 py-2 hover:bg-slate-800/50 transition-colors">
            <div className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-center gap-x-3 gap-y-1.5">
              {/* Clickable main area */}
              <button
                onClick={() => onSelect(member)}
                className="flex-1 min-w-0 min-h-[56px] flex flex-wrap items-center gap-x-3 gap-y-1 text-left cursor-pointer rounded-xl
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                aria-label={`View profile for ${member.name}`}
              >
                {/* Name + membership number */}
                <div className="flex-1 basis-40 min-w-0">
                  <p className="text-white text-lg leading-snug font-bold truncate">{member.name}</p>
                  <p className="text-slate-400 text-[15px]">{member.membership_number}</p>
                </div>

                {/* Tier badge */}
                <span className="ui-tag ui-tag-neutral capitalize shrink-0">
                  {member.membership_tier ?? 'member'}
                </span>

                {/* Renewal alert — icon + text, never colour alone */}
                {renewalSoon && (
                  <span className="ui-tag ui-tag-warn shrink-0" aria-label="Renewal due soon">
                    <Clock size={14} aria-hidden="true" />
                    <span>Renewal due</span>
                  </span>
                )}
              </button>

              {/* Tab balance — rendered outside the profile-open button so the
                  blur/reveal tap doesn't navigate. Visible to customers when
                  the till faces the bar, hence the BlurredAmount wrapper. */}
              {(member.tab_blocked || hasTab) && (
                <div className="flex flex-wrap items-center gap-2 shrink-0 pb-1.5 sm:pb-0">
                  {member.tab_blocked && (
                    <span className="ui-tag ui-tag-bad shrink-0">
                      <Lock size={14} aria-hidden="true" />
                      <span>Tab blocked</span>
                    </span>
                  )}
                  {hasTab && (
                    <span className="ui-tag ui-tag-accent text-[15px] shrink-0">
                      <span>Tab:</span>
                      <BlurredAmount className="text-blue-300 font-extrabold">
                        £{Number(member.tab_balance).toFixed(2)}
                      </BlurredAmount>
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Edit button */}
            <button
              onClick={e => { e.stopPropagation(); onEdit(member) }}
              aria-label={`Edit ${member.name}`}
              className="ui-btn ui-btn-icon text-slate-300 hover:bg-slate-700 hover:text-white shrink-0"
            >
              <Pencil size={20} aria-hidden="true" />
            </button>
          </li>
        )
      })}
    </ul>
  )
}
