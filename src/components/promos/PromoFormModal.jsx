// src/components/promos/PromoFormModal.jsx
import { useState, useEffect, useRef, useId } from 'react'
import { X, Plus, Trash2 } from '../../lib/icons'
import { upsertPromotion, replacePromotionItems, replacePromotionCategories } from '../../lib/promotions'

const SCHEDULE_TYPES = [
  { value: 'time', label: 'Time window (recurring)' },
  { value: 'date', label: 'Date range (one-off)' },
  { value: 'always', label: 'Always active' },
]

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const CATEGORIES = ['draught', 'bottle', 'spirit', 'soft', 'food', 'other']

function detectScheduleType(promo) {
  if (promo?.start_time) return 'time'
  if (promo?.start_date || promo?.end_date) return 'date'
  return 'always'
}

export default function PromoFormModal({ promo, products = [], onClose, onSaved }) {
  const isEditing = promo != null
  const titleId = useId()
  const firstInputRef = useRef(null)
  const overlayRef = useRef(null)

  const [name, setName] = useState(promo?.name ?? '')
  const [scheduleType, setScheduleType] = useState(detectScheduleType(promo))
  const [startTime, setStartTime] = useState(promo?.start_time ?? '17:00')
  const [endTime, setEndTime] = useState(promo?.end_time ?? '19:00')
  const [daysOfWeek, setDaysOfWeek] = useState(promo?.days_of_week ?? [1, 2, 3, 4, 5])
  const [startDate, setStartDate] = useState(promo?.start_date ?? '')
  const [endDate, setEndDate] = useState(promo?.end_date ?? '')
  const [items, setItems] = useState(
    promo?.promotion_items?.map(i => ({
      product_id: i.product_id,
      discount_type: i.discount_type,
      discount_value: String(i.discount_value),
    })) ?? []
  )
  const [categoryItems, setCategoryItems] = useState(
    promo?.promotion_categories?.map(c => ({
      category: c.category,
      discount_type: c.discount_type,
      discount_value: String(c.discount_value),
    })) ?? []
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => { firstInputRef.current?.focus() }, [])

  useEffect(() => {
    function handleKey(e) { if (e.key === 'Escape' && !saving) onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose, saving])

  function handleOverlayClick(e) {
    if (saving) return
    if (e.target === overlayRef.current) onClose()
  }

  function toggleDay(day) {
    setDaysOfWeek(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort()
    )
  }

  function addItem() {
    setItems(prev => [...prev, { product_id: '', discount_type: 'percentage', discount_value: '10' }])
  }

  function removeItem(index) {
    setItems(prev => prev.filter((_, i) => i !== index))
  }

  function updateItem(index, field, value) {
    setItems(prev => prev.map((item, i) => i === index ? { ...item, [field]: value } : item))
  }

  function addCategoryItem() {
    setCategoryItems(prev => [...prev, { category: 'draught', discount_type: 'percentage', discount_value: '10' }])
  }

  function removeCategoryItem(index) {
    setCategoryItems(prev => prev.filter((_, i) => i !== index))
  }

  function updateCategoryItem(index, field, value) {
    setCategoryItems(prev => prev.map((item, i) => i === index ? { ...item, [field]: value } : item))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    // Validate no duplicate categories
    const cats = categoryItems.map(c => c.category)
    if (new Set(cats).size !== cats.length) {
      setError('Each category can only appear once.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const payload = {
        ...(isEditing ? { id: promo.id } : {}),
        name: name.trim(),
        active: promo?.active ?? true,
        start_time: scheduleType === 'time' ? startTime : null,
        end_time: scheduleType === 'time' ? endTime : null,
        days_of_week: scheduleType === 'time' ? (daysOfWeek.length > 0 ? daysOfWeek : null) : null,
        start_date: scheduleType === 'date' ? (startDate || null) : null,
        end_date: scheduleType === 'date' ? (endDate || null) : null,
      }

      const saved = await upsertPromotion(payload)

      const itemRows = items
        .filter(i => i.product_id)
        .map(i => ({
          product_id: i.product_id,
          discount_type: i.discount_type,
          discount_value: Number(i.discount_value),
        }))
      await replacePromotionItems(saved.id, itemRows)
      const catRows = categoryItems
        .filter(c => c.discount_value !== '' && Number(c.discount_value) > 0)
        .map(c => ({
          category: c.category,
          discount_type: c.discount_type,
          discount_value: Number(c.discount_value),
        }))
      await replacePromotionCategories(saved.id, catRows)
      onSaved()
    } catch (err) {
      setError(err.message ?? 'An error occurred. Please try again.')
      setSaving(false)
    }
  }

  const inputCls = "ui-input [color-scheme:dark]"
  const labelCls = "ui-label"

  return (
    <div
      ref={overlayRef}
      className="ui-modal-backdrop"
      onClick={handleOverlayClick}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="ui-modal max-w-xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <h2
            id={titleId}
            className="ui-modal-title"
          >
            {isEditing ? 'Edit Promotion' : 'Add Promotion'}
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
            <label htmlFor="prom-name" className={labelCls}>
              Name <span aria-hidden="true">*</span>
            </label>
            <input
              ref={firstInputRef}
              id="prom-name"
              type="text"
              required
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Happy Hour"
              className={inputCls}
              aria-label="Promotion name"
            />
          </div>

          {/* Schedule type */}
          <div>
            <label htmlFor="prom-schedule" className={labelCls}>Schedule type</label>
            <select
              id="prom-schedule"
              value={scheduleType}
              onChange={e => setScheduleType(e.target.value)}
              className="ui-select w-full"
            >
              {SCHEDULE_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          {/* Time window fields */}
          {scheduleType === 'time' && (
            <>
              <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="prom-start-time" className={labelCls}>Start time</label>
                  <input
                    id="prom-start-time"
                    type="time"
                    value={startTime}
                    onChange={e => setStartTime(e.target.value)}
                    required
                    className={inputCls}
                    aria-label="Start time"
                  />
                </div>
                <div>
                  <label htmlFor="prom-end-time" className={labelCls}>End time</label>
                  <input
                    id="prom-end-time"
                    type="time"
                    value={endTime}
                    onChange={e => setEndTime(e.target.value)}
                    required
                    className={inputCls}
                    aria-label="End time"
                  />
                </div>
              </div>

              <div>
                <span className={labelCls}>Days of week</span>
                <div className="flex flex-wrap gap-2">
                  {DAY_LABELS.map((label, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => toggleDay(i)}
                      className={`ui-tab min-w-[56px] ${daysOfWeek.includes(i) ? 'ui-tab-active' : ''}`}
                      aria-pressed={daysOfWeek.includes(i)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="ui-help mt-2">Select no days to apply every day.</p>
              </div>
            </>
          )}

          {/* Date range fields */}
          {scheduleType === 'date' && (
            <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3">
              <div>
                <label htmlFor="prom-start-date" className={labelCls}>Start date</label>
                <input
                  id="prom-start-date"
                  type="date"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  className={inputCls}
                  aria-label="Start date"
                />
              </div>
              <div>
                <label htmlFor="prom-end-date" className={labelCls}>End date</label>
                <input
                  id="prom-end-date"
                  type="date"
                  value={endDate}
                  onChange={e => setEndDate(e.target.value)}
                  className={inputCls}
                  aria-label="End date"
                />
              </div>
            </div>
          )}

          {/* Promotion items */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3 border-t border-slate-800 pt-4">
              <span className="ui-section-title">Products &amp; discounts</span>
              <button
                type="button"
                onClick={addItem}
                className="ui-btn ui-btn-secondary"
              >
                <Plus size={18} aria-hidden="true" />
                Add product
              </button>
            </div>

            {items.length === 0 && (
              <p className="ui-help">No products added yet.</p>
            )}

            {items.map((item, index) => (
              <div key={index} className="flex flex-wrap gap-2 items-end rounded-xl bg-slate-800/50 p-3 sm:bg-transparent sm:p-0">
                <div className="basis-full sm:basis-0 sm:flex-1 min-w-0">
                  <label className="ui-label">Product</label>
                  <select
                    value={item.product_id}
                    onChange={e => updateItem(index, 'product_id', e.target.value)}
                    required
                    className="ui-select w-full"
                    aria-label={`Product ${index + 1}`}
                  >
                    <option value="">Select product…</option>
                    {products.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="ui-label">Type</label>
                  <select
                    value={item.discount_type}
                    onChange={e => updateItem(index, 'discount_type', e.target.value)}
                    className="ui-select"
                    aria-label={`Discount type ${index + 1}`}
                  >
                    <option value="percentage">%</option>
                    <option value="fixed_price">£</option>
                  </select>
                </div>
                <div className="flex-1 sm:flex-none sm:w-24 min-w-0">
                  <label className="ui-label">Value</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={item.discount_value}
                    onChange={e => updateItem(index, 'discount_value', e.target.value)}
                    required
                    placeholder="10"
                    className="ui-input"
                    aria-label={`Discount value ${index + 1}`}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeItem(index)}
                  aria-label="Remove product line"
                  className="ui-btn ui-btn-danger ui-btn-icon shrink-0"
                >
                  <Trash2 size={20} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>

          {/* Category discounts */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3 border-t border-slate-800 pt-4">
              <span className="ui-section-title">Categories &amp; discounts</span>
              <button
                type="button"
                onClick={addCategoryItem}
                className="ui-btn ui-btn-secondary"
              >
                <Plus size={18} aria-hidden="true" />
                Add category
              </button>
            </div>

            {categoryItems.length === 0 && (
              <p className="ui-help">No categories added yet.</p>
            )}

            {categoryItems.map((item, index) => (
              <div key={index} className="flex flex-wrap gap-2 items-end rounded-xl bg-slate-800/50 p-3 sm:bg-transparent sm:p-0">
                <div className="basis-full sm:basis-0 sm:flex-1 min-w-0">
                  <label className="ui-label">Category</label>
                  <select
                    value={item.category}
                    onChange={e => updateCategoryItem(index, 'category', e.target.value)}
                    className="ui-select w-full"
                    aria-label={`Category ${index + 1}`}
                  >
                    {CATEGORIES.map(cat => (
                      <option key={cat} value={cat}>{cat.charAt(0).toUpperCase() + cat.slice(1)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="ui-label">Type</label>
                  <select
                    value={item.discount_type}
                    onChange={e => updateCategoryItem(index, 'discount_type', e.target.value)}
                    className="ui-select"
                    aria-label={`Category discount type ${index + 1}`}
                  >
                    <option value="percentage">%</option>
                    <option value="fixed_price">£</option>
                  </select>
                </div>
                <div className="flex-1 sm:flex-none sm:w-24 min-w-0">
                  <label className="ui-label">Value</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={item.discount_value}
                    onChange={e => updateCategoryItem(index, 'discount_value', e.target.value)}
                    required
                    placeholder="10"
                    className="ui-input"
                    aria-label={`Category discount value ${index + 1}`}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeCategoryItem(index)}
                  aria-label="Remove category line"
                  className="ui-btn ui-btn-danger ui-btn-icon shrink-0"
                >
                  <Trash2 size={20} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>

          {/* Actions */}
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
              {saving ? 'Saving…' : isEditing ? 'Save Changes' : 'Add Promotion'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
