// src/components/promos/PromoFormModal.jsx
import { useState, useEffect, useRef, useId } from 'react'
import { X, Plus, Trash2 } from '../../lib/icons'
import { upsertPromotion, replacePromotionItems } from '../../lib/promotions'

const SCHEDULE_TYPES = [
  { value: 'time', label: 'Time window (recurring)' },
  { value: 'date', label: 'Date range (one-off)' },
  { value: 'always', label: 'Always active' },
]

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

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
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => { firstInputRef.current?.focus() }, [])

  useEffect(() => {
    function handleKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  function handleOverlayClick(e) {
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

  async function handleSubmit(e) {
    e.preventDefault()
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
      onSaved()
    } catch (err) {
      setError(err.message ?? 'An error occurred. Please try again.')
      setSaving(false)
    }
  }

  const inputCls = "bg-[#1E293B] border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 min-h-[44px] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617] w-full"
  const labelCls = "text-sm font-medium text-slate-300"

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 overflow-y-auto"
      onClick={handleOverlayClick}
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
            style={{ fontFamily: "'Playfair Display SC', serif" }}
          >
            {isEditing ? 'Edit Promotion' : 'Add Promotion'}
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
        <form onSubmit={handleSubmit} className="px-5 py-5 flex flex-col gap-4 overflow-y-auto max-h-[80vh]">
          {error && (
            <p role="alert" className="text-red-400 text-sm bg-red-400/10 px-3 py-2 rounded-lg">
              {error}
            </p>
          )}

          {/* Name */}
          <div className="flex flex-col gap-1">
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
          <div className="flex flex-col gap-1">
            <label htmlFor="prom-schedule" className={labelCls}>Schedule type</label>
            <select
              id="prom-schedule"
              value={scheduleType}
              onChange={e => setScheduleType(e.target.value)}
              className={inputCls + ' cursor-pointer'}
            >
              {SCHEDULE_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          {/* Time window fields */}
          {scheduleType === 'time' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
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
                <div className="flex flex-col gap-1">
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

              <div className="flex flex-col gap-2">
                <span className={labelCls}>Days of week</span>
                <div className="flex flex-wrap gap-2">
                  {DAY_LABELS.map((label, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => toggleDay(i)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer
                        focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]
                        ${daysOfWeek.includes(i)
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}
                      aria-pressed={daysOfWeek.includes(i)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="text-slate-500 text-xs">Select no days to apply every day.</p>
              </div>
            </>
          )}

          {/* Date range fields */}
          {scheduleType === 'date' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
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
              <div className="flex flex-col gap-1">
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
            <div className="flex items-center justify-between">
              <span className={labelCls}>Products &amp; discounts</span>
              <button
                type="button"
                onClick={addItem}
                className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-1"
              >
                <Plus size={12} aria-hidden="true" />
                Add product
              </button>
            </div>

            {items.length === 0 && (
              <p className="text-slate-500 text-xs italic">No products added yet.</p>
            )}

            {items.map((item, index) => (
              <div key={index} className="flex gap-2 items-end">
                <div className="flex-1 flex flex-col gap-1">
                  <label className="text-xs text-slate-400">Product</label>
                  <select
                    value={item.product_id}
                    onChange={e => updateItem(index, 'product_id', e.target.value)}
                    required
                    className="bg-[#1E293B] border border-slate-600 rounded-lg px-2 py-2 text-white text-sm min-h-[40px] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617] cursor-pointer"
                    aria-label={`Product ${index + 1}`}
                  >
                    <option value="">Select product…</option>
                    {products.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-400">Type</label>
                  <select
                    value={item.discount_type}
                    onChange={e => updateItem(index, 'discount_type', e.target.value)}
                    className="bg-[#1E293B] border border-slate-600 rounded-lg px-2 py-2 text-white text-sm min-h-[40px] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617] cursor-pointer"
                    aria-label={`Discount type ${index + 1}`}
                  >
                    <option value="percentage">%</option>
                    <option value="fixed_price">£</option>
                  </select>
                </div>
                <div className="w-20 flex flex-col gap-1">
                  <label className="text-xs text-slate-400">Value</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={item.discount_value}
                    onChange={e => updateItem(index, 'discount_value', e.target.value)}
                    required
                    placeholder="10"
                    className="bg-[#1E293B] border border-slate-600 rounded-lg px-2 py-2 text-white text-sm min-h-[40px] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
                    aria-label={`Discount value ${index + 1}`}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeItem(index)}
                  aria-label="Remove product line"
                  className="text-slate-500 hover:text-red-400 transition-colors min-h-[40px] min-w-[40px] flex items-center justify-center cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </div>
            ))}
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
              {saving ? 'Saving…' : isEditing ? 'Save Changes' : 'Add Promotion'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
