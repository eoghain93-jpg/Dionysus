import { useState, useEffect, useRef, useId } from 'react'
import { X } from '../../lib/icons'
import { logStockMovement } from '../../lib/products'

/**
 * Modal for logging wastage, spillage, or restock movements.
 * Props:
 *   product  — the product object
 *   type     — 'wastage' | 'spillage' | 'restock'
 *   onClose  — called when the modal should close
 *   onSaved  — called after a successful save (triggers re-fetch in parent)
 */
export default function StockMovementModal({ product, type, onClose, onSaved }) {
  const [quantity, setQuantity] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const titleId = useId()
  const firstInputRef = useRef(null)
  const overlayRef = useRef(null)

  // Focus the first input when the modal opens
  useEffect(() => {
    firstInputRef.current?.focus()
  }, [])

  // Close on Escape key
  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  function handleOverlayClick(e) {
    if (e.target === overlayRef.current) onClose()
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const qty = Number(quantity)
    if (!qty || qty <= 0) {
      setError('Please enter a positive quantity.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await logStockMovement({
        product_id: product.id,
        type,
        quantity: qty,
        notes: notes.trim() || null,
      })
      onSaved()
    } catch (err) {
      setError(err.message ?? 'An error occurred. Please try again.')
      setSaving(false)
    }
  }

  const typeLabel = type === 'restock' ? 'Restock' : type === 'wastage' ? 'Log Wastage' : 'Log Spillage'
  const actionVerb = type === 'restock' ? 'Add stock for' : type === 'wastage' ? 'Log wastage for' : 'Log spillage for'

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={handleOverlayClick}
      aria-hidden="false"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-sm bg-[#0F172A] border border-slate-700 rounded-2xl shadow-xl flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-slate-700">
          <h2
            id={titleId}
            className="text-lg font-bold text-white"
            style={{ fontFamily: "'Playfair Display SC', serif" }}
          >
            {typeLabel}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close modal"
            className="text-slate-400 hover:text-white transition-colors cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="px-5 py-5 flex flex-col gap-4">
          <p className="text-slate-400 text-sm">
            {actionVerb}{' '}
            <span className="text-white font-semibold">{product.name}</span>
          </p>

          {error && (
            <p role="alert" className="text-red-400 text-sm bg-red-400/10 px-3 py-2 rounded-lg">
              {error}
            </p>
          )}

          <div className="flex flex-col gap-1">
            <label htmlFor="movement-qty" className="text-sm font-medium text-slate-300">
              Quantity <span aria-hidden="true">*</span>
            </label>
            <input
              ref={firstInputRef}
              id="movement-qty"
              type="number"
              min="1"
              step="1"
              required
              value={quantity}
              onChange={e => setQuantity(e.target.value)}
              placeholder="e.g. 2"
              className="bg-[#1E293B] border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 min-h-[44px] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="movement-notes" className="text-sm font-medium text-slate-300">
              Notes <span className="text-slate-500 font-normal">(optional)</span>
            </label>
            <textarea
              id="movement-notes"
              rows={2}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Reason or extra details..."
              className="bg-[#1E293B] border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
            />
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 min-h-[44px] rounded-xl border border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors cursor-pointer text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 min-h-[44px] rounded-xl bg-[#22C55E] hover:bg-green-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-900 font-bold text-sm transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
            >
              {saving ? 'Saving…' : typeLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
