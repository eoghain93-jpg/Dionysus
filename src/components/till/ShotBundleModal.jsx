import { useState } from 'react'
import { X, RotateCcw } from 'lucide-react'
import { useTillStore } from '../../stores/tillStore'

const BUNDLE_QTY = 4
const BUNDLE_TOTAL = 10.00
const UNIT_PRICE = BUNDLE_TOTAL / BUNDLE_QTY

// Only these spirits are eligible for the 4-for-£10 deal. Match is
// case-insensitive substring against product.name so "Sambuca Black",
// "Tequila Rose", etc. would also qualify if they were on the menu.
// To change the eligible list, edit this array — no DB migration needed.
const BUNDLE_ELIGIBLE_KEYWORDS = ['sambuca', 'fireball', 'tequila']

function isBundleEligible(product) {
  if (product.category !== 'spirit') return false
  const lower = product.name.toLowerCase()
  return BUNDLE_ELIGIBLE_KEYWORDS.some(kw => lower.includes(kw))
}

/**
 * ShotBundleModal — pick 4 spirits for £10 (the always-on shot promo).
 *
 * Staff taps the spirit tiles to build a 4-shot selection. Same spirit can
 * be tapped multiple times (e.g., 4 vodkas). When 4 are selected the
 * Confirm button activates and adds 4 line items at £2.50 each to the
 * current order — stock decrements per individual spirit so inventory
 * stays accurate.
 */
export default function ShotBundleModal({ products, onClose }) {
  const addBundleItems = useTillStore(s => s.addBundleItems)
  const [selected, setSelected] = useState([]) // array of product objects (duplicates allowed)

  const spirits = products.filter(isBundleEligible)
  const remaining = BUNDLE_QTY - selected.length
  const isReady = selected.length === BUNDLE_QTY

  function handlePick(product) {
    if (selected.length >= BUNDLE_QTY) return
    setSelected([...selected, product])
  }

  function handleRemove(idx) {
    setSelected(selected.filter((_, i) => i !== idx))
  }

  function handleReset() {
    setSelected([])
  }

  function handleConfirm() {
    addBundleItems(selected, BUNDLE_TOTAL)
    onClose()
  }

  // Show selected as a compact summary (collapse duplicates of same product)
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
      aria-labelledby="shot-bundle-title"
    >
      <div className="ui-modal max-w-3xl p-0 gap-0 overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 md:px-6 pt-5 pb-4 border-b border-slate-800">
          <div>
            <h2 id="shot-bundle-title" className="ui-modal-title">4 Shots for £10</h2>
            <p className="ui-subtitle mt-1">
              {isReady
                ? 'Ready — tap Add to Order.'
                : `Pick ${remaining} more ${remaining === 1 ? 'spirit' : 'spirits'} — Sambuca, Fireball or Tequila.`}
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

        {/* Spirit grid */}
        <div className="flex-1 min-h-0 overflow-auto px-5 md:px-6 py-5">
          {spirits.length === 0 ? (
            <p className="ui-empty">
              No eligible spirits configured for this promotion. Add Sambuca, Fireball or Tequila to the menu first.
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {spirits.map(product => {
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
                      £{product.standard_price.toFixed(2)} normally
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
            <span className="text-white text-[22px] font-extrabold">£{(UNIT_PRICE * selected.length).toFixed(2)}</span>
            <span> / £{BUNDLE_TOTAL.toFixed(2)}</span>
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
            Add to Order — £{BUNDLE_TOTAL.toFixed(2)}
          </button>
        </div>
      </div>
    </div>
  )
}

// Same tile as the till's product grid, in the spirit category tint.
const TINT = { bg: '#231F33', border: '#463D73', text: '#B9ADF2' }
const TILE_CLASS = `relative rounded-2xl border-[1.5px] px-3.5 py-3 text-left text-white
  flex flex-col justify-between gap-2 min-h-[88px] cursor-pointer
  transition-transform duration-100 active:scale-[0.97]
  disabled:opacity-50 disabled:cursor-not-allowed
  focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400`
