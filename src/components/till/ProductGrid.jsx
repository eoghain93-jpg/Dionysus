// src/components/till/ProductGrid.jsx
import { useTillStore } from '../../stores/tillStore'
import { getPromoPrice } from '../../lib/promos'
import { ImageIcon } from '../../lib/icons'

export default function ProductGrid({ products, now = new Date() }) {
  const { addItem, activeMember, activePromos } = useTillStore()

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
      {products.map(product => {
        const promoPrice = getPromoPrice(product, activePromos, now)
        const memberPrice = activeMember ? product.member_price : null

        const candidates = [product.standard_price]
        if (memberPrice != null) candidates.push(memberPrice)
        if (promoPrice != null) candidates.push(promoPrice)
        const displayPrice = Math.min(...candidates)

        const hasPromo = promoPrice != null && promoPrice === displayPrice
        const isLowStock = product.stock_quantity <= product.par_level

        return (
          <button
            key={product.id}
            onClick={() => addItem(product, now)}
            className="bg-slate-800 hover:bg-slate-700 active:bg-blue-700 active:scale-95
              rounded-xl text-left transition-all duration-150 flex flex-col overflow-hidden
              relative cursor-pointer focus:outline-none focus:ring-2
              focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
          >
            {/* Image header */}
            <div className="relative w-full h-20 flex-shrink-0">
              {product.image_url ? (
                <img
                  src={product.image_url}
                  alt=""
                  className="w-full h-full object-contain p-3"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <ImageIcon size={22} className="text-slate-700" aria-hidden="true" />
                </div>
              )}
              {hasPromo && (
                <span
                  className="absolute top-1.5 left-1.5 bg-amber-500 text-slate-900 text-[10px] font-bold
                    uppercase tracking-wide px-1.5 py-0.5 rounded-full leading-none"
                  aria-label="Promotion active"
                >
                  PROMO
                </span>
              )}
              {isLowStock && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-amber-400" aria-label="Low stock" />
              )}
            </div>

            {/* Body */}
            <div className="px-2.5 pt-1 pb-2.5 flex flex-col gap-0.5">
              <span className="text-white font-medium text-sm leading-tight">{product.name}</span>
              <span className="text-slate-400 text-xs capitalize">{product.category}</span>
              <span className="text-blue-400 font-bold text-base mt-1">£{displayPrice.toFixed(2)}</span>
            </div>
          </button>
        )
      })}
    </div>
  )
}
