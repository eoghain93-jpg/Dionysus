// src/components/promos/PromoList.jsx
import { Edit2 } from '../../lib/icons'

function formatSchedule(promo) {
  if (promo.start_time && promo.end_time) {
    const days = promo.days_of_week?.length
      ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
          .filter((_, i) => promo.days_of_week.includes(i))
          .join(', ')
      : 'Every day'
    return `${days} ${promo.start_time}–${promo.end_time}`
  }
  if (promo.start_date && promo.end_date) {
    if (promo.start_date === promo.end_date) return promo.start_date
    return `${promo.start_date} – ${promo.end_date}`
  }
  if (promo.start_date) return `From ${promo.start_date}`
  if (promo.end_date) return `Until ${promo.end_date}`
  return 'Always'
}

export default function PromoList({ promos, onToggle, onEdit }) {
  if (promos.length === 0) {
    return (
      <p className="ui-empty px-4">
        No promotions yet. Click "Add Promo" to create one.
      </p>
    )
  }

  return (
    <ul>
      {promos.map(promo => (
        <li
          key={promo.id}
          className="ui-row gap-4 py-3"
        >
          {/* Active toggle */}
          <button
            role="switch"
            aria-checked={promo.active}
            aria-label={`${promo.active ? 'Deactivate' : 'Activate'} ${promo.name}`}
            onClick={() => onToggle(promo)}
            className={`relative inline-flex h-9 w-16 items-center rounded-full transition-colors shrink-0 cursor-pointer
              before:absolute before:-inset-x-1 before:-inset-y-2 before:content-['']
              focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#121314]
              ${promo.active ? 'bg-blue-600' : 'bg-slate-700'}`}
          >
            <span
              className={`inline-block h-7 w-7 transform rounded-full bg-white transition-transform
                ${promo.active ? 'translate-x-8' : 'translate-x-1'}`}
            />
          </button>

          {/* Promo details */}
          <div className="flex-1 min-w-0">
            <p className={`text-lg font-extrabold leading-tight truncate ${promo.active ? 'text-white' : 'text-slate-400'}`}>{promo.name}</p>
            <p className="text-slate-300 text-[15px] truncate">{formatSchedule(promo)}</p>
            <p className="text-slate-400 text-sm">
              {promo.promotion_items?.length ?? 0} product{promo.promotion_items?.length !== 1 ? 's' : ''}
            </p>
          </div>

          {/* Edit button */}
          <button
            onClick={() => onEdit(promo)}
            aria-label={`Edit ${promo.name}`}
            className="ui-btn ui-btn-ghost ui-btn-icon shrink-0"
          >
            <Edit2 size={20} aria-hidden="true" />
            <span className="sr-only">Edit</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
