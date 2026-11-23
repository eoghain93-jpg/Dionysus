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
      className="ui-modal-backdrop"
      onClick={handleOverlayClick}
      aria-hidden="false"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="ui-modal"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <h2
            id={titleId}
            className="ui-modal-title"
          >
            {typeLabel}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close modal"
            className="ui-btn ui-btn-ghost ui-btn-icon shrink-0"
          >
            <X size={22} aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <p className="text-slate-300 text-base">
            {actionVerb}{' '}
            <span className="text-white font-extrabold">{product.name}</span>
          </p>

          {error && (
            <p role="alert" className="ui-banner ui-banner-bad">
              {error}
            </p>
          )}

          <div>
            <label htmlFor="movement-qty" className="ui-label">
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
              className="ui-input min-h-[56px] text-xl font-bold"
            />
          </div>

          <div>
            <label htmlFor="movement-notes" className="ui-label">
              Notes <span className="text-slate-400 font-semibold">(optional)</span>
            </label>
            <textarea
              id="movement-notes"
              rows={2}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Reason or extra details..."
              className="ui-input py-3 resize-none"
            />
          </div>

          <div className="ui-modal-actions">
            <button
              type="button"
              onClick={onClose}
              className="ui-btn ui-btn-ghost ui-btn-lg flex-1"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className={`ui-btn ui-btn-lg flex-1 ${type === 'restock' ? 'ui-btn-pay' : 'ui-btn-primary'}`}
            >
              {saving ? 'Saving…' : typeLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
