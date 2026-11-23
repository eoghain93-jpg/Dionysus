import { useState, useEffect, useRef, useId } from 'react'
import { X, ImageIcon } from '../../lib/icons'
import { upsertProduct } from '../../lib/products'
import { useSessionStore } from '../../stores/sessionStore'
import PinGate from '../till/PinGate'

const CATEGORIES = ['draught', 'bottle', 'spirit', 'soft', 'food', 'other']
const UNITS = ['pint', 'measure', 'bottle', 'each']

/**
 * Modal for adding or editing a product.
 * Props:
 *   product  — null for new product, object for editing
 *   onClose  — called when the modal should close
 *   onSaved  — called after a successful save
 *
 * Setting or changing a price needs a signed-in staff member to confirm
 * with their PIN; their id travels with the save so the price change log
 * (product_price_changes, written by a database trigger) records who did it.
 * Edits that leave both prices alone save without a PIN.
 */
export default function ProductFormModal({ product, onClose, onSaved }) {
  const isEditing = product != null
  const titleId = useId()
  const firstInputRef = useRef(null)
  const overlayRef = useRef(null)

  const [form, setForm] = useState({
    name: product?.name ?? '',
    category: product?.category ?? 'draught',
    standard_price: product?.standard_price ?? '',
    member_price: product?.member_price ?? '',
    stock_quantity: product?.stock_quantity ?? '',
    par_level: product?.par_level ?? '',
    unit: product?.unit ?? 'pint',
    supplier_id: product?.supplier_id ?? '',
    cost_price: product?.cost_price ?? '',
    image_url: product?.image_url ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [showPinGate, setShowPinGate] = useState(false)
  const activeStaff = useSessionStore(s => s.activeStaff)

  const pricesChanged = !isEditing
    || Number(form.standard_price) !== Number(product.standard_price)
    || Number(form.member_price) !== Number(product.member_price)

  useEffect(() => {
    firstInputRef.current?.focus()
  }, [])

  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape' && !showPinGate) onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose, showPinGate])

  function handleOverlayClick(e) {
    if (e.target === overlayRef.current) onClose()
  }

  function handleChange(field) {
    return e => setForm(prev => ({ ...prev, [field]: e.target.value }))
  }

  function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    if (!pricesChanged) return save()
    if (!activeStaff) {
      setError('Sign in on the Till screen first — price changes are recorded against a staff member.')
      return
    }
    setShowPinGate(true)
  }

  async function save(staffId) {
    setShowPinGate(false)
    setSaving(true)
    setError(null)
    try {
      const payload = {
        ...(isEditing ? { id: product.id } : {}),
        name: form.name.trim(),
        category: form.category,
        standard_price: Number(form.standard_price),
        member_price: Number(form.member_price),
        stock_quantity: Number(form.stock_quantity),
        par_level: Number(form.par_level),
        unit: form.unit,
        active: true,
      }
      if (form.supplier_id.trim()) payload.supplier_id = form.supplier_id.trim()
      if (form.cost_price !== '') payload.cost_price = Number(form.cost_price)
      if (form.image_url) payload.image_url = form.image_url
      // Pass-through for the price change log; the database blanks it again.
      if (staffId) payload.changed_by = staffId

      await upsertProduct(payload)
      onSaved()
    } catch (err) {
      setError(err.message ?? 'An error occurred. Please try again.')
      setSaving(false)
    }
  }

  return (
    <>
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
        className="ui-modal max-w-lg"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <h2
            id={titleId}
            className="ui-modal-title"
          >
            {isEditing ? 'Edit Product' : 'Add Product'}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close modal"
            className="ui-btn ui-btn-ghost ui-btn-icon shrink-0"
          >
            <X size={22} aria-hidden="true" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {error && (
            <p role="alert" className="ui-banner ui-banner-bad">
              {error}
            </p>
          )}

          {/* Name */}
          <div>
            <label htmlFor="pf-name" className="ui-label">
              Name <span aria-hidden="true">*</span>
            </label>
            <input
              ref={firstInputRef}
              id="pf-name"
              type="text"
              required
              value={form.name}
              onChange={handleChange('name')}
              placeholder="Product name"
              className="ui-input"
            />
          </div>

          {/* Category + Unit */}
          <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3">
            <div>
              <label htmlFor="pf-category" className="ui-label">
                Category <span aria-hidden="true">*</span>
              </label>
              <select
                id="pf-category"
                required
                value={form.category}
                onChange={handleChange('category')}
                className="ui-select w-full capitalize"
              >
                {CATEGORIES.map(c => (
                  <option key={c} value={c} className="capitalize">{c}</option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="pf-unit" className="ui-label">
                Unit <span aria-hidden="true">*</span>
              </label>
              <select
                id="pf-unit"
                required
                value={form.unit}
                onChange={handleChange('unit')}
                className="ui-select w-full capitalize"
              >
                {UNITS.map(u => (
                  <option key={u} value={u} className="capitalize">{u}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Standard price + Member price */}
          <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3">
            <div>
              <label htmlFor="pf-standard-price" className="ui-label">
                Standard Price (£) <span aria-hidden="true">*</span>
              </label>
              <input
                id="pf-standard-price"
                type="number"
                min="0"
                step="0.01"
                required
                value={form.standard_price}
                onChange={handleChange('standard_price')}
                placeholder="0.00"
                className="ui-input"
              />
            </div>

            <div>
              <label htmlFor="pf-member-price" className="ui-label">
                Member Price (£) <span aria-hidden="true">*</span>
              </label>
              <input
                id="pf-member-price"
                type="number"
                min="0"
                step="0.01"
                required
                value={form.member_price}
                onChange={handleChange('member_price')}
                placeholder="0.00"
                className="ui-input"
              />
            </div>
          </div>

          {/* Stock quantity + Par level */}
          <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3">
            <div>
              <label htmlFor="pf-stock-qty" className="ui-label">
                Stock Quantity <span aria-hidden="true">*</span>
              </label>
              <input
                id="pf-stock-qty"
                type="number"
                min="0"
                step="1"
                required
                value={form.stock_quantity}
                onChange={handleChange('stock_quantity')}
                placeholder="0"
                className="ui-input"
              />
            </div>

            <div>
              <label htmlFor="pf-par-level" className="ui-label">
                Par Level <span aria-hidden="true">*</span>
              </label>
              <input
                id="pf-par-level"
                type="number"
                min="0"
                step="1"
                required
                value={form.par_level}
                onChange={handleChange('par_level')}
                placeholder="0"
                className="ui-input"
              />
            </div>
          </div>

          {/* Cost price (optional) */}
          <div>
            <label htmlFor="pf-cost-price" className="ui-label">
              Cost Price (£) <span className="text-slate-400 font-semibold">(optional)</span>
            </label>
            <input
              id="pf-cost-price"
              type="number"
              min="0"
              step="0.01"
              value={form.cost_price}
              onChange={handleChange('cost_price')}
              placeholder="0.00"
              className="ui-input"
            />
          </div>

          {/* Supplier ID (optional) */}
          <div>
            <label htmlFor="pf-supplier-id" className="ui-label">
              Supplier ID <span className="text-slate-400 font-semibold">(optional)</span>
            </label>
            <input
              id="pf-supplier-id"
              type="text"
              value={form.supplier_id}
              onChange={handleChange('supplier_id')}
              placeholder="Supplier UUID or reference"
              className="ui-input"
            />
          </div>

          {/* Product Image (optional) */}
          <div>
            <label htmlFor="pf-image-url" className="ui-label">
              Logo URL <span className="text-slate-400 font-semibold">(optional)</span>
            </label>
            <div className="flex items-center gap-3">
              {/* Preview */}
              <div className="w-16 h-16 rounded-xl bg-slate-800 flex items-center justify-center flex-shrink-0 overflow-hidden border border-slate-700">
                {form.image_url ? (
                  <img src={form.image_url} alt="Logo preview" className="w-full h-full object-contain p-1" />
                ) : (
                  <ImageIcon size={24} className="text-slate-400" aria-hidden="true" />
                )}
              </div>
              <div className="flex flex-col items-start gap-1.5 flex-1 min-w-0">
                <input
                  id="pf-image-url"
                  type="url"
                  value={form.image_url}
                  onChange={handleChange('image_url')}
                  placeholder="https://img.logo.dev/guinness.com?token=…"
                  className="ui-input"
                />
                {form.image_url && (
                  <button
                    type="button"
                    onClick={() => setForm(prev => ({ ...prev, image_url: '' }))}
                    className="ui-btn ui-btn-danger min-h-[44px]"
                  >
                    Remove logo
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Actions */}
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
              className="ui-btn ui-btn-primary ui-btn-lg flex-1"
            >
              {saving ? 'Saving…' : isEditing ? 'Save Changes' : 'Add Product'}
            </button>
          </div>
        </form>
      </div>
    </div>
    {showPinGate && (
      <PinGate
        label={isEditing ? `Change price — ${product.name}` : 'Set price'}
        purpose="price_change"
        onConfirm={() => save(activeStaff.id)}
        onCancel={() => setShowPinGate(false)}
      />
    )}
    </>
  )
}
