const CATEGORIES = ['all', 'draught', 'bottle', 'spirit', 'soft', 'food', 'other']

const LABELS = {
  all: 'All',
  draught: 'Draught',
  bottle: 'Bottle',
  spirit: 'Spirit',
  soft: 'Soft',
  food: 'Food',
  other: 'Wine',
}

export default function CategoryFilter({ active, onChange }) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
      {CATEGORIES.map(cat => (
        <button
          key={cat}
          onClick={() => onChange(cat)}
          className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap
            transition-colors duration-200 cursor-pointer min-h-[44px]
            focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]
            ${active === cat
              ? 'bg-blue-600 text-white'
              : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white'}`}
        >
          {LABELS[cat]}
        </button>
      ))}
    </div>
  )
}
