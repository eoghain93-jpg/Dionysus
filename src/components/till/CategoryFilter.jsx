const CATEGORIES = ['popular', 'all', 'draught', 'bottle', 'spirit', 'soft', 'food', 'other']

const LABELS = {
  popular: 'Popular',
  all: 'All',
  draught: 'Draught',
  bottle: 'Bottle',
  spirit: 'Spirit',
  soft: 'Soft',
  food: 'Food',
  other: 'Wine',
}

/**
 * @param {boolean} [showPopular] - offer the "Popular" tab (only when there is
 *                                  sales history to rank the best sellers by)
 */
export default function CategoryFilter({ active, onChange, showPopular = false }) {
  const categories = showPopular ? CATEGORIES : CATEGORIES.filter(c => c !== 'popular')
  return (
    <div className="flex gap-2 overflow-x-auto scrollbar-hide">
      {categories.map(cat => (
        <button
          key={cat}
          onClick={() => onChange(cat)}
          aria-pressed={active === cat}
          className={`flex-1 px-4 rounded-xl text-[15px] font-bold whitespace-nowrap border
            transition-colors duration-150 cursor-pointer min-h-[48px]
            focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400
            focus-visible:ring-offset-2 focus-visible:ring-offset-[#121314]
            ${active === cat
              ? 'bg-slate-100 border-slate-100 text-[#121314]'
              : 'bg-transparent border-slate-700 text-slate-100 hover:bg-slate-800'}`}
        >
          {LABELS[cat]}
        </button>
      ))}
    </div>
  )
}
