import { useState, useRef, useId } from 'react'
import { X } from '../../lib/icons'
import { adjustTabBalance } from '../../lib/tabs'
import { useSessionStore } from '../../stores/sessionStore'

export default function AdjustTabModal({ member, onClose, onAdjusted }) {
  const titleId = useId()
  const overlayRef = useRef(null)
  const { activeStaff } = useSessionStore()

  const [amount, setAmount] = useState('')
  const [direction, setDirection] = useState('subtract') // 'add' | 'subtract'
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  function handleOverlayClick(e) {
    if (e.target === overlayRef.current && !saving) onClose()
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const val = parseFloat(amount)
    if (!val || val <= 0) { setError('Enter a valid amount'); return }
    if (!reason.trim()) { setError('Reason is required'); return }
    const signed = direction === 'subtract' ? -val : val
    setSaving(true)
    setError(null)
    try {
      await adjustTabBalance(member.id, signed, reason.trim(), activeStaff?.id)
      onAdjusted(signed)
    } catch (err) {
      setError(err.message ?? 'Failed to adjust balance')
      setSaving(false)
    }
  }

  const inputCls = "bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-full min-h-[44px]"

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={handleOverlayClick}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-sm bg-[#0F172A] border border-slate-700 rounded-2xl shadow-xl flex flex-col"
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-slate-700">
          <h2
            id={titleId}
            className="text-lg font-bold text-white"
            style={{ fontFamily: "'Playfair Display SC', serif" }}
          >
            Adjust Tab — {member.name}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-slate-400 hover:text-white cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-5 flex flex-col gap-4">
          <p className="text-slate-400 text-sm">
            Current balance: <span className="text-white font-bold">£{Number(member.tab_balance).toFixed(2)}</span>
          </p>

          <div className="flex flex-col gap-1">
            <label className="text-slate-300 text-sm">Adjustment type</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setDirection('subtract')}
                className={`flex-1 min-h-[44px] rounded-xl text-sm font-medium cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500
                  ${direction === 'subtract' ? 'bg-red-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
                aria-pressed={direction === 'subtract'}
              >
                Reduce (−)
              </button>
              <button
                type="button"
                onClick={() => setDirection('add')}
                className={`flex-1 min-h-[44px] rounded-xl text-sm font-medium cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500
                  ${direction === 'add' ? 'bg-green-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
                aria-pressed={direction === 'add'}
              >
                Add (+)
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="adjust-amount" className="text-slate-300 text-sm">Amount (£)</label>
            <input
              id="adjust-amount"
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="e.g. 5.00"
              className={inputCls}
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="adjust-reason" className="text-slate-300 text-sm">Reason <span aria-hidden="true">*</span></label>
            <input
              id="adjust-reason"
              type="text"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="e.g. Corrected error, wrote off £5"
              className={inputCls}
              required
            />
          </div>

          {error && <p role="alert" className="text-red-400 text-sm">{error}</p>}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 min-h-[44px] rounded-xl border border-slate-600 text-slate-300 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 min-h-[44px] rounded-xl bg-[#22C55E] hover:bg-green-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-900 font-bold text-sm cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {saving ? 'Saving…' : 'Apply'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
