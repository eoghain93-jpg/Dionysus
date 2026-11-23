import { useState } from 'react'
import { X } from '../../lib/icons'
import { logWastage } from '../../lib/stockMovements'

export default function WastageModal({ products, onClose, onSaved }) {
  const draughtProducts = products.filter(p => p.category === 'draught')
  const [productId, setProductId] = useState(draughtProducts[0]?.id ?? '')
  const [quantity, setQuantity] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    const qty = parseFloat(quantity)
    if (!qty || qty <= 0) { setError('Enter a valid quantity'); return }
    setSaving(true)
    setError(null)
    try {
      await logWastage(productId, qty)
      onSaved()
    } catch (err) {
      setError(err.message ?? 'Failed to log wastage')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="ui-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Record Wastage"
    >
      <div className="ui-modal max-w-xl">
        <div className="flex items-start justify-between gap-3">
          <h2 className="ui-modal-title">Record Wastage</h2>
          <button onClick={onClose} aria-label="Close" className="ui-btn ui-btn-ghost ui-btn-icon shrink-0">
            <X size={22} aria-hidden="true" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label htmlFor="wastage-product" className="ui-label">Product</label>
            <select
              id="wastage-product"
              value={productId}
              onChange={e => setProductId(e.target.value)}
              className="sr-only"
            >
              {draughtProducts.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-[38dvh] overflow-auto -m-1 p-1">
              {draughtProducts.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setProductId(p.id)}
                  aria-pressed={p.id === productId}
                  className={`${PICK_TILE} ${p.id === productId ? PICK_TILE_ON : PICK_TILE_OFF}`}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label htmlFor="wastage-quantity" className="ui-label">Quantity (pints)</label>
            <input
              id="wastage-quantity"
              type="number"
              min="0.1"
              step="0.1"
              value={quantity}
              onChange={e => setQuantity(e.target.value)}
              placeholder="e.g. 4"
              className="ui-input min-h-[56px] text-xl font-bold"
            />
          </div>
          {error && <p role="alert" className="ui-error">{error}</p>}
          <div className="ui-modal-actions">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="ui-btn ui-btn-ghost ui-btn-lg flex-1"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="ui-btn ui-btn-primary ui-btn-lg flex-1"
            >
              {saving ? 'Saving\u2026' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// Product tiles in the till's style. The labelled <select> stays in the DOM
// (visually hidden) as the real form control; the tiles drive the same state.
const PICK_TILE = `min-h-[64px] rounded-2xl border-[1.5px] px-3.5 py-2.5 text-left text-[17px] leading-tight
  font-semibold cursor-pointer transition-transform duration-100 active:scale-[0.97]
  focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400`
const PICK_TILE_ON = 'bg-blue-950 border-blue-400 text-white'
const PICK_TILE_OFF = 'bg-slate-800 border-slate-700 text-slate-100 hover:bg-slate-700'
