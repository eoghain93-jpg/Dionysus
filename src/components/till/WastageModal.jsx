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
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Record Wastage"
    >
      <div className="bg-[#0F172A] border border-slate-700 rounded-2xl w-full max-w-sm p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-white font-bold text-lg">Record Wastage</h2>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-white cursor-pointer">
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="wastage-product" className="text-slate-300 text-sm">Product</label>
            <select
              id="wastage-product"
              value={productId}
              onChange={e => setProductId(e.target.value)}
              className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {draughtProducts.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="wastage-quantity" className="text-slate-300 text-sm">Quantity (pints)</label>
            <input
              id="wastage-quantity"
              type="number"
              min="0.1"
              step="0.1"
              value={quantity}
              onChange={e => setQuantity(e.target.value)}
              placeholder="e.g. 4"
              className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {error && <p role="alert" className="text-red-400 text-sm">{error}</p>}
          <div className="flex gap-2 mt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 min-h-[44px] rounded-xl border border-slate-600 text-slate-300 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 min-h-[44px] rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold cursor-pointer transition-colors"
            >
              {saving ? 'Saving\u2026' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
