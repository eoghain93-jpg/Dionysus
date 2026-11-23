import { useState } from 'react'
import { X, RotateCcw } from 'lucide-react'
import { useTillStore, bottleBundlePricing } from '../../stores/tillStore'
import { isBottleBundleEligible } from '../../lib/bottleBundle'
import { logEvent } from '../../lib/audit/log'

const BUNDLE_QTY = 5

/**
 * BottleBundleModal — pick any 5 across the eligible bottles, pay for 4.
 *
 * Staff tap bottle tiles (mix and match, same bottle multiple times) to build
 * a selection of 5. When 5 are picked, Confirm adds them to the order priced
 * as "the price of 4" (cheapest bottle's worth comes off the total, spread
 * evenly across the lines). Stock decrements per bottle, so the free bottle
 * still comes off the count. For 10 bottles, run the deal twice.
 */
export default function BottleBundleModal({ products, onClose }) {
  const addBottleBundle = useTillStore(s => s.addBottleBundle)
  const activeMember = useTillStore(s => s.activeMember)
  const membersOnlyMode = useTillStore(s => s.membersOnlyMode)
  const [selected, setSelected] = useState([]) // array of product objects (duplicates allowed)

  const bottles = products.filter(isBottleBundleEligible)
  const remaining = BUNDLE_QTY - selected.length
  const isReady = selected.length === BUNDLE_QTY

  // Live preview of what the customer pays. Uses the SAME pricing function as
  // the store (and the same member base) so the label here can never disagree
  // with the cart total.
  const useMember = !!(activeMember || membersOnlyMode)
  const dealTotal = bottleBundlePricing(selected, useMember).total

  function handlePick(product) {
    if (selected.length >= BUNDLE_QTY) return
    setSelected([...selected, product])
  }

  function handleReset() {
    setSelected([])
  }

  function handleConfirm() {
    addBottleBundle(selected)
    onClose()
    logEvent('cart.bundle_added', {
      bundle: 'bottles_5_for_4',
      lines: summary.length,
      value: dealTotal,
      items: summary.map(s => ({ product: s.name, quantity: s.qty })),
      member_prices: useMember,
    })
  }

  // Collapse duplicates of the same product for the summary chips.
  const summary = selected.reduce((acc, p) => {
    const existing = acc.find(s => s.id === p.id)
    if (existing) existing.qty++
    else acc.push({ ...p, qty: 1 })
    return acc
  }, [])

  return (
    <div
      className="ui-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bottle-bundle-title"
    >
      <div className="ui-modal max-w-3xl p-0 gap-0 overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 md:px-6 pt-5 pb-4 border-b border-slate-800">
          <div>
            <h2 id="bottle-bundle-title" className="ui-modal-title">5 Bottles for the Price of 4</h2>
            <p className="ui-subtitle mt-1">
              {isReady
                ? 'Ready — tap Add to Order.'
                : `Pick ${remaining} more ${remaining === 1 ? 'bottle' : 'bottles'} — San Miguel, Carlsberg or Budweiser.`}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="ui-btn ui-btn-ghost ui-btn-icon shrink-0"
          >
            <X size={22} aria-hidden="true" />
          </button>
        </div>

        {/* Selected summary */}
        <div className="px-5 md:px-6 py-3 border-b border-slate-800 flex flex-wrap gap-2 items-center min-h-[72px]">
          {summary.length === 0 ? (
            <p className="text-slate-400 text-[15px]">Nothing selected yet</p>
          ) : (
            <>
              {summary.map((item, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center gap-1.5 bg-slate-100 text-[#121314] text-[15px] font-bold px-3 py-1.5 rounded-full"
                >
                  {item.qty > 1 && <span className="font-extrabold">{item.qty}×</span>}
                  {item.name}
                </span>
              ))}
              <button
                type="button"
                onClick={handleReset}
                className="ui-btn ui-btn-ghost ml-auto"
              >
                <RotateCcw size={18} aria-hidden="true" /> Reset
              </button>
            </>
          )}
        </div>

        {/* Bottle grid */}
        <div className="flex-1 min-h-0 overflow-auto px-5 md:px-6 py-5">
          {bottles.length === 0 ? (
            <p className="ui-empty">
              No eligible bottles found. This deal needs San Miguel, Carlsberg (Bottle) or Budweiser on the menu.
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {bottles.map(product => {
                const count = selected.filter(s => s.id === product.id).length
                return (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => handlePick(product)}
                    disabled={selected.length >= BUNDLE_QTY}
                    className={TILE_CLASS}
                    style={{ backgroundColor: TINT.bg, borderColor: count > 0 ? TINT.text : TINT.border }}
                  >
                    {count > 0 && (
                      <span
                        aria-label={`${count} selected`}
                        className="absolute top-2.5 right-2.5 min-w-[28px] h-7 px-1.5 rounded-full bg-slate-100
                          text-[#121314] text-[15px] font-extrabold leading-7 text-center"
                      >
                        {count}
                      </span>
                    )}
                    <span className="font-semibold text-[17px] leading-tight pr-8">{product.name}</span>
                    <span className="text-[15px] font-semibold" style={{ color: TINT.text }}>
                      £{(useMember && product.member_price != null ? product.member_price : product.standard_price).toFixed(2)} normally
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-5 md:px-6 py-4 border-t border-slate-800 flex flex-wrap gap-3 items-center">
          <div className="mr-auto text-slate-400 text-[15px] font-semibold">
            <span className="text-white text-[22px] font-extrabold">£{dealTotal.toFixed(2)}</span>
            {isReady && <span className="text-emerald-300"> — price of 4</span>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ui-btn ui-btn-ghost ui-btn-lg"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!isReady}
            className="ui-btn ui-btn-primary ui-btn-lg flex-1 sm:flex-none"
          >
            Add to Order — £{dealTotal.toFixed(2)}
          </button>
        </div>
      </div>
    </div>
  )
}

// Same tile as the till's product grid, in the bottle category tint.
const TINT = { bg: '#14262A', border: '#244E57', text: '#7FCBD6' }
const TILE_CLASS = `relative rounded-2xl border-[1.5px] px-3.5 py-3 text-left text-white
  flex flex-col justify-between gap-2 min-h-[88px] cursor-pointer
  transition-transform duration-100 active:scale-[0.97]
  disabled:opacity-50 disabled:cursor-not-allowed
  focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400`
