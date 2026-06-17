import { useState } from 'react'
import { X, RotateCcw } from 'lucide-react'
import { useTillStore, bottleBundlePricing } from '../../stores/tillStore'

// Marker promotion that gates this button. Staff toggle a promo with this
// EXACT name on (at kickoff) to reveal the "5 for 4 Bottles" button, and off
// after the match. See isBundleEnabled in lib/promos.js.
export const BOTTLE_BUNDLE_PROMO_NAME = 'Bottle 5-for-4'

const BUNDLE_QTY = 5

// EXACT product names eligible for the deal — matched case-insensitively
// against the whole name (not substring), so "San Miguel 0%" and
// "Carlsberg 0%" are deliberately excluded and the draught "Carlsberg" is
// excluded by the category guard below. Edit this list to change the lineup.
export const BOTTLE_BUNDLE_ELIGIBLE_NAMES = ['San Miguel', 'Carlsberg (Bottle)', 'Budweiser']

const ELIGIBLE = new Set(BOTTLE_BUNDLE_ELIGIBLE_NAMES.map(n => n.toLowerCase()))

function isBundleEligible(product) {
  if (product.category !== 'bottle') return false
  return ELIGIBLE.has(product.name.trim().toLowerCase())
}

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
  const [selected, setSelected] = useState([]) // array of product objects (duplicates allowed)

  const bottles = products.filter(isBundleEligible)
  const remaining = BUNDLE_QTY - selected.length
  const isReady = selected.length === BUNDLE_QTY

  // Live preview of what the customer pays. Uses the SAME pricing function as
  // the store so the label here can never disagree with the cart total.
  const dealTotal = bottleBundlePricing(selected).total

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
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bottle-bundle-title"
    >
      <div className="bg-[#0F172A] border border-slate-700 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-700">
          <div>
            <h2 id="bottle-bundle-title" className="text-white text-lg font-bold">5 Bottles for the Price of 4</h2>
            <p className="text-slate-400 text-sm">
              {isReady
                ? 'Ready — tap Confirm to add to the order.'
                : `Pick ${remaining} more ${remaining === 1 ? 'bottle' : 'bottles'} — San Miguel, Carlsberg or Budweiser.`}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-slate-400 hover:text-white cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        {/* Selected summary */}
        <div className="px-5 py-3 border-b border-slate-700 flex flex-wrap gap-2 items-center min-h-[60px]">
          {summary.length === 0 ? (
            <p className="text-slate-500 text-sm italic">Nothing selected yet</p>
          ) : (
            <>
              {summary.map((item, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center gap-1.5 bg-emerald-700 text-white text-sm font-medium px-3 py-1.5 rounded-lg"
                >
                  {item.qty > 1 && <span className="font-bold">{item.qty}×</span>}
                  {item.name}
                </span>
              ))}
              <button
                type="button"
                onClick={handleReset}
                className="ml-auto text-slate-400 hover:text-white text-sm flex items-center gap-1 cursor-pointer min-h-[36px] px-2"
              >
                <RotateCcw size={14} aria-hidden="true" /> Reset
              </button>
            </>
          )}
        </div>

        {/* Bottle grid */}
        <div className="flex-1 overflow-auto p-5">
          {bottles.length === 0 ? (
            <p className="text-slate-500 text-sm text-center py-8">
              No eligible bottles found. This deal needs San Miguel, Carlsberg (Bottle) or Budweiser on the menu.
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {bottles.map(product => {
                const count = selected.filter(s => s.id === product.id).length
                return (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => handlePick(product)}
                    disabled={selected.length >= BUNDLE_QTY}
                    className={`relative bg-slate-800 hover:bg-slate-700 active:scale-95 rounded-xl p-3
                      text-left transition-all duration-150 flex flex-col gap-1 cursor-pointer
                      min-h-[72px] border-l-[3px] border-l-amber-500
                      disabled:opacity-50 disabled:cursor-not-allowed
                      focus:outline-none focus:ring-2 focus:ring-blue-500`}
                  >
                    {count > 0 && (
                      <span
                        aria-label={`${count} selected`}
                        className="absolute top-2 right-2 bg-emerald-500 text-white text-xs font-bold
                          rounded-full w-6 h-6 flex items-center justify-center"
                      >
                        {count}
                      </span>
                    )}
                    <span className="text-white font-medium text-sm leading-tight pr-7">{product.name}</span>
                    <span className="text-slate-400 text-xs">£{product.standard_price.toFixed(2)} normally</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-5 py-4 border-t border-slate-700 flex gap-3 items-center">
          <div className="text-slate-400 text-sm">
            <span className="text-white font-bold">£{dealTotal.toFixed(2)}</span>
            {isReady && <span className="text-emerald-400 text-xs"> — price of 4</span>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto min-h-[44px] px-4 rounded-xl border border-slate-600 text-slate-300
              hover:bg-slate-700 cursor-pointer text-sm font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!isReady}
            className="min-h-[44px] px-5 rounded-xl bg-emerald-600 hover:bg-emerald-500
              disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold
              cursor-pointer transition-colors"
          >
            Add to Order — £{dealTotal.toFixed(2)}
          </button>
        </div>
      </div>
    </div>
  )
}
