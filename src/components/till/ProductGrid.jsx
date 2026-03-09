import { useTillStore } from '../../stores/tillStore'

export default function ProductGrid({ products }) {
  const { addItem, activeMember } = useTillStore()

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
      {products.map(product => {
        const price = activeMember ? product.member_price : product.standard_price
        const isLowStock = product.stock_quantity <= product.par_level
        return (
          <button
            key={product.id}
            onClick={() => addItem(product)}
            className="bg-slate-800 hover:bg-slate-700 active:bg-blue-700 active:scale-95
              rounded-xl p-3 text-left transition-all duration-150 flex flex-col gap-1
              relative cursor-pointer min-h-[80px] focus:outline-none focus:ring-2
              focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
          >
            {isLowStock && (
              <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-amber-400" aria-label="Low stock" />
            )}
            <span className="text-white font-medium text-sm leading-tight">{product.name}</span>
            <span className="text-slate-400 text-xs capitalize">{product.category}</span>
            <span className="text-blue-400 font-bold text-base mt-auto">£{price.toFixed(2)}</span>
          </button>
        )
      })}
    </div>
  )
}
