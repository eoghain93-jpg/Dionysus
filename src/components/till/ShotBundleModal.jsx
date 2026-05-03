import { useState } from 'react'
import { X, RotateCcw } from 'lucide-react'
import { useTillStore } from '../../stores/tillStore'

const BUNDLE_QTY = 4
const BUNDLE_TOTAL = 10.00
const UNIT_PRICE = BUNDLE_TOTAL / BUNDLE_QTY

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

  const spirits = products.filter(p => p.category === 'spirit')
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
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shot-bundle-title"
    >
      <div className="bg-[#0F172A] border border-slate-700 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-700">
          <div>
            <h2 id="shot-bundle-title" className="text-white text-lg font-bold">4 Shots for £10</h2>
            <p className="text-slate-400 text-sm">
              {isReady
                ? 'Ready — tap Confirm to add to the order.'
                : `Pick ${remaining} more ${remaining === 1 ? 'spirit' : 'spirits'}.`}
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

        {/* Spirit grid */}
        <div className="flex-1 overflow-auto p-5">
          {spirits.length === 0 ? (
            <p className="text-slate-500 text-sm text-center py-8">No spirit products configured.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {spirits.map(product => {
                const count = selected.filter(s => s.id === product.id).length
                return (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => handlePick(product)}
                    disabled={selected.length >= BUNDLE_QTY}
                    className={`relative bg-slate-800 hover:bg-slate-700 active:scale-95 rounded-xl p-3
                      text-left transition-all duration-150 flex flex-col gap-1 cursor-pointer
                      min-h-[72px] border-l-[3px] border-l-purple-500
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
            <span className="text-white font-bold">£{(UNIT_PRICE * selected.length).toFixed(2)}</span>
            <span className="text-slate-500 text-xs"> / £{BUNDLE_TOTAL.toFixed(2)}</span>
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
            Add to Order — £{BUNDLE_TOTAL.toFixed(2)}
          </button>
        </div>
      </div>
    </div>
  )
}
