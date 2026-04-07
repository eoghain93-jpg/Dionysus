import { useState, useEffect, useRef, useId } from 'react'
import { X, ImageIcon } from '../../lib/icons'
import { upsertProduct } from '../../lib/products'

const CATEGORIES = ['draught', 'bottle', 'spirit', 'soft', 'food', 'other']
const UNITS = ['pint', 'measure', 'bottle', 'each']

/**
 * Modal for adding or editing a product.
 * Props:
 *   product  — null for new product, object for editing
 *   onClose  — called when the modal should close
 *   onSaved  — called after a successful save
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

  useEffect(() => {
    firstInputRef.current?.focus()
  }, [])

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

  function handleChange(field) {
    return e => setForm(prev => ({ ...prev, [field]: e.target.value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
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

      await upsertProduct(payload)
      onSaved()
    } catch (err) {
      setError(err.message ?? 'An error occurred. Please try again.')
      setSaving(false)
    }
  }

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 overflow-y-auto"
      onClick={handleOverlayClick}
      aria-hidden="false"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-lg bg-[#0F172A] border border-slate-700 rounded-2xl shadow-xl flex flex-col my-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-slate-700">
          <h2
            id={titleId}
            className="text-lg font-bold text-white"
          >
            {isEditing ? 'Edit Product' : 'Add Product'}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close modal"
            className="text-slate-400 hover:text-white transition-colors cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-5 py-5 flex flex-col gap-4">
          {error && (
            <p role="alert" className="text-red-400 text-sm bg-red-400/10 px-3 py-2 rounded-lg">
              {error}
            </p>
          )}

          {/* Name */}
          <div className="flex flex-col gap-1">
            <label htmlFor="pf-name" className="text-sm font-medium text-slate-300">
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
              className="bg-[#1E293B] border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 min-h-[44px] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
            />
          </div>

          {/* Category + Unit */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="pf-category" className="text-sm font-medium text-slate-300">
                Category <span aria-hidden="true">*</span>
              </label>
              <select
                id="pf-category"
                required
                value={form.category}
                onChange={handleChange('category')}
                className="bg-[#1E293B] border border-slate-600 rounded-lg px-3 py-2 text-white min-h-[44px] capitalize focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617] cursor-pointer"
              >
                {CATEGORIES.map(c => (
                  <option key={c} value={c} className="capitalize">{c}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="pf-unit" className="text-sm font-medium text-slate-300">
                Unit <span aria-hidden="true">*</span>
              </label>
              <select
                id="pf-unit"
                required
                value={form.unit}
                onChange={handleChange('unit')}
                className="bg-[#1E293B] border border-slate-600 rounded-lg px-3 py-2 text-white min-h-[44px] capitalize focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617] cursor-pointer"
              >
                {UNITS.map(u => (
                  <option key={u} value={u} className="capitalize">{u}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Standard price + Member price */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="pf-standard-price" className="text-sm font-medium text-slate-300">
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
                className="bg-[#1E293B] border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 min-h-[44px] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="pf-member-price" className="text-sm font-medium text-slate-300">
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
                className="bg-[#1E293B] border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 min-h-[44px] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
              />
            </div>
          </div>

          {/* Stock quantity + Par level */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="pf-stock-qty" className="text-sm font-medium text-slate-300">
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
                className="bg-[#1E293B] border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 min-h-[44px] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="pf-par-level" className="text-sm font-medium text-slate-300">
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
                className="bg-[#1E293B] border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 min-h-[44px] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
              />
            </div>
          </div>

          {/* Cost price (optional) */}
          <div className="flex flex-col gap-1">
            <label htmlFor="pf-cost-price" className="text-sm font-medium text-slate-300">
              Cost Price (£) <span className="text-slate-500 font-normal">(optional)</span>
            </label>
            <input
              id="pf-cost-price"
              type="number"
              min="0"
              step="0.01"
              value={form.cost_price}
              onChange={handleChange('cost_price')}
              placeholder="0.00"
              className="bg-[#1E293B] border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 min-h-[44px] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
            />
          </div>

          {/* Supplier ID (optional) */}
          <div className="flex flex-col gap-1">
            <label htmlFor="pf-supplier-id" className="text-sm font-medium text-slate-300">
              Supplier ID <span className="text-slate-500 font-normal">(optional)</span>
            </label>
            <input
              id="pf-supplier-id"
              type="text"
              value={form.supplier_id}
              onChange={handleChange('supplier_id')}
              placeholder="Supplier UUID or reference"
              className="bg-[#1E293B] border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 min-h-[44px] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
            />
          </div>

          {/* Product Image (optional) */}
          <div className="flex flex-col gap-2">
            <label htmlFor="pf-image-url" className="text-sm font-medium text-slate-300">
              Logo URL <span className="text-slate-500 font-normal">(optional)</span>
            </label>
            <div className="flex items-center gap-3">
              {/* Preview */}
              <div className="w-16 h-16 rounded-lg bg-slate-900 flex items-center justify-center flex-shrink-0 overflow-hidden border border-slate-700">
                {form.image_url ? (
                  <img src={form.image_url} alt="Logo preview" className="w-full h-full object-contain p-1" />
                ) : (
                  <ImageIcon size={20} className="text-slate-600" aria-hidden="true" />
                )}
              </div>
              <div className="flex flex-col gap-1.5 flex-1">
                <input
                  id="pf-image-url"
                  type="url"
                  value={form.image_url}
                  onChange={handleChange('image_url')}
                  placeholder="https://img.logo.dev/guinness.com?token=…"
                  className="bg-[#1E293B] border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 text-sm min-h-[44px] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
                />
                {form.image_url && (
                  <button
                    type="button"
                    onClick={() => setForm(prev => ({ ...prev, image_url: '' }))}
                    className="text-xs text-slate-500 hover:text-red-400 transition-colors text-left cursor-pointer"
                  >
                    Remove logo
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Actions */}
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
              {saving ? 'Saving…' : isEditing ? 'Save Changes' : 'Add Product'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
