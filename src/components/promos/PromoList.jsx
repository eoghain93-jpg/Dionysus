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
      <p className="text-slate-400 text-sm p-6 text-center">
        No promotions yet. Click "Add Promo" to create one.
      </p>
    )
  }

  return (
    <ul className="divide-y divide-slate-700">
      {promos.map(promo => (
        <li
          key={promo.id}
          className="flex items-center gap-3 px-4 py-3"
        >
          {/* Active toggle */}
          <button
            role="switch"
            aria-checked={promo.active}
            aria-label={`${promo.active ? 'Deactivate' : 'Activate'} ${promo.name}`}
            onClick={() => onToggle(promo)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]
              ${promo.active ? 'bg-[#22C55E]' : 'bg-slate-600'}`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform
                ${promo.active ? 'translate-x-6' : 'translate-x-1'}`}
            />
          </button>

          {/* Promo details */}
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-medium truncate">{promo.name}</p>
            <p className="text-slate-400 text-xs truncate">{formatSchedule(promo)}</p>
            <p className="text-slate-500 text-xs">
              {promo.promotion_items?.length ?? 0} product{promo.promotion_items?.length !== 1 ? 's' : ''}
            </p>
          </div>

          {/* Edit button */}
          <button
            onClick={() => onEdit(promo)}
            aria-label={`Edit ${promo.name}`}
            className="text-slate-400 hover:text-white transition-colors cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
          >
            <Edit2 size={16} aria-hidden="true" />
            <span className="sr-only">Edit</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
