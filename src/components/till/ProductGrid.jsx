// src/components/till/ProductGrid.jsx
import { useTillStore, resolveSalePrice } from '../../stores/tillStore'
import { getPromoDiscount } from '../../lib/promos'

// Each category has its own tint so staff find a drink by colour as well as
// by name. Tile background, border, and the colour of the price.
const CATEGORY_TINTS = {
  draught: { bg: '#2B2415', border: '#57451F', text: '#E9BE6B' },
  bottle: { bg: '#14262A', border: '#244E57', text: '#7FCBD6' },
  spirit: { bg: '#231F33', border: '#463D73', text: '#B9ADF2' },
  soft: { bg: '#18281B', border: '#2D5733', text: '#9FD3A0' },
  food: { bg: '#301F19', border: '#673B2B', text: '#F0A088' },
  other: { bg: '#311B25', border: '#6A2F49', text: '#F09CC0' },
}
const DEFAULT_TINT = { bg: '#232629', border: '#363A3F', text: '#F2F3F4' }

const TILE_CLASS = `relative rounded-2xl border-[1.5px] px-3.5 py-3 text-left text-white
  flex flex-col justify-between gap-2 min-h-[100px] cursor-pointer
  transition-transform duration-100 active:scale-[0.97]
  focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400
  focus-visible:ring-offset-2 focus-visible:ring-offset-[#121314]`

/**
 * @param {object[]} products
 * @param {object[]} [deals]    - bundle tiles shown ahead of the products:
 *                                { key, name, price, category, onClick }
 * @param {function} [onAdded]  - called with the product after a tile tap
 *                                (drives the till's Undo prompt)
 */
export default function ProductGrid({ products, deals = [], onAdded, now = new Date() }) {
  const { addItem, orderItems, activeMember, activePromos, membersOnlyMode } = useTillStore()

  // How many of each product are on the order, across every kind of line.
  const inOrder = {}
  for (const item of orderItems) {
    inOrder[item.product_id] = (inOrder[item.product_id] ?? 0) + item.quantity
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-2.5">
      {deals.map(deal => {
        const tint = CATEGORY_TINTS[deal.category] ?? DEFAULT_TINT
        return (
          <button
            key={deal.key}
            onClick={deal.onClick}
            className={TILE_CLASS}
            style={{ backgroundColor: tint.bg, borderColor: tint.border }}
          >
            <span className="font-semibold text-[17px] leading-tight">{deal.name}</span>
            <span className="flex items-baseline gap-2">
              <span className="font-extrabold text-xl" style={{ color: tint.text }}>{deal.price}</span>
              <span className="ml-auto text-xs font-extrabold uppercase tracking-wide">Deal</span>
            </span>
          </button>
        )
      })}
      {products.map(product => {
        // Same pricing as the cart (resolveSalePrice), so the tile price and the
        // PROMO tag reflect exactly what addItem will charge — including a promo
        // stacked on a member's price.
        const memberPrice = (activeMember || membersOnlyMode) ? product.member_price : null
        const promo = getPromoDiscount(product, activePromos, now)
        const { price: displayPrice, promo_price_applied: hasPromo } =
          resolveSalePrice({ product, memberPrice, promo })

        const isLowStock = product.stock_quantity <= product.par_level
        const tint = CATEGORY_TINTS[product.category] ?? DEFAULT_TINT
        const quantity = inOrder[product.id] ?? 0
        const discounted = displayPrice < product.standard_price

        return (
          <button
            key={product.id}
            onClick={() => { addItem(product, now); onAdded?.(product) }}
            className={TILE_CLASS}
            style={{ backgroundColor: tint.bg, borderColor: quantity > 0 ? tint.text : tint.border }}
          >
            {quantity > 0 && (
              <span
                aria-label={`${quantity} on the order`}
                className="absolute top-2.5 right-2.5 min-w-[28px] h-7 px-1.5 rounded-full bg-slate-100
                  text-[#121314] text-[15px] font-extrabold leading-7 text-center"
              >
                {quantity}
              </span>
            )}
            <span className="font-semibold text-[17px] leading-tight pr-8">{product.name}</span>
            <span className="flex items-baseline gap-2 flex-wrap">
              <span className="font-extrabold text-xl" style={{ color: tint.text }}>
                £{displayPrice.toFixed(2)}
              </span>
              {discounted && (
                <s className="text-slate-400 text-[13px]">£{product.standard_price.toFixed(2)}</s>
              )}
              {hasPromo && (
                <span
                  className="bg-amber-500 text-slate-950 text-[11px] font-extrabold uppercase tracking-wide
                    px-1.5 py-0.5 rounded-full leading-none"
                  aria-label="Promotion active"
                >
                  PROMO
                </span>
              )}
              {isLowStock && (
                <span className="ml-auto text-amber-400 text-xs font-extrabold uppercase tracking-wide">
                  Low stock
                </span>
              )}
            </span>
          </button>
        )
      })}
    </div>
  )
}
