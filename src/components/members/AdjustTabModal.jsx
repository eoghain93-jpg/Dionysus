import { useState, useRef, useId } from 'react'
import { X } from '../../lib/icons'
import { adjustTabBalance } from '../../lib/tabs'
import { useSessionStore } from '../../stores/sessionStore'

export default function AdjustTabModal({ member, onClose, onAdjusted }) {
  const titleId = useId()
  const overlayRef = useRef(null)
  const { activeStaff } = useSessionStore()

  const [amount, setAmount] = useState('')
  // Nothing to reduce on an empty tab, so default to adding.
  const [direction, setDirection] = useState(
    Number(member.tab_balance) > 0 ? 'subtract' : 'add'
  ) // 'add' | 'subtract'
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
        className="ui-modal"
      >
        <div className="flex items-start justify-between gap-3">
          <h2
            id={titleId}
            className="ui-modal-title min-w-0 pt-2"
          >
            Adjust Tab — {member.name}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="ui-btn ui-btn-ghost ui-btn-icon shrink-0"
          >
            <X size={22} aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <p className="rounded-2xl bg-slate-800 px-5 py-3 text-slate-300 text-base flex items-baseline justify-between gap-3 flex-wrap">
            Current balance: <span className="text-white text-2xl font-extrabold">£{Number(member.tab_balance).toFixed(2)}</span>
          </p>

          <div>
            <label className="ui-label">Adjustment type</label>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setDirection('subtract')}
                className={`ui-tab ${direction === 'subtract' ? 'ui-tab-active' : ''}`}
                aria-pressed={direction === 'subtract'}
              >
                Reduce (−)
              </button>
              <button
                type="button"
                onClick={() => setDirection('add')}
                className={`ui-tab ${direction === 'add' ? 'ui-tab-active' : ''}`}
                aria-pressed={direction === 'add'}
              >
                Add (+)
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="adjust-amount" className="ui-label">Amount (£)</label>
            <input
              id="adjust-amount"
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="e.g. 5.00"
              className="ui-input text-xl font-bold"
              autoFocus
            />
          </div>

          <div>
            <label htmlFor="adjust-reason" className="ui-label">Reason <span aria-hidden="true">*</span></label>
            <input
              id="adjust-reason"
              type="text"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="e.g. Corrected error, wrote off £5"
              className="ui-input"
              required
            />
          </div>

          {error && <p role="alert" className="ui-banner ui-banner-bad">{error}</p>}

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
              {saving ? 'Saving…' : 'Apply'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
