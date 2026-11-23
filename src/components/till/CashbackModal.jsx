import { useState } from 'react'
import { X } from '../../lib/icons'
import { recordCashback } from '../../lib/cashback'
import { useSessionStore } from '../../stores/sessionStore'
import { openDrawer } from '../../lib/starPrinter'
import { useToastStore } from '../../hooks/useToast'
import { logEvent } from '../../lib/audit/log'

export default function CashbackModal({ onClose, onSaved }) {
  const { activeStaff } = useSessionStore()
  const addToast = useToastStore(s => s.addToast)
  const [amount, setAmount] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    const val = parseFloat(amount)
    if (!val || val <= 0) { setError('Enter a valid amount'); return }
    setSaving(true)
    setError(null)
    try {
      await recordCashback(val, activeStaff?.id)
      try {
        await openDrawer()
      } catch (err) {
        addToast('Drawer failed — use manual open in Settings', 'error')
        // Explains the manual "Open Drawer" that usually follows.
        logEvent('drawer.open_failed', { source: 'cashback', message: String(err?.message ?? err).slice(0, 300) }, { severity: 1 })
      }
      onSaved()
    } catch (err) {
      setError(err.message ?? 'Failed to record cashback')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="ui-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Record Cashback"
    >
      <div className="ui-modal">
        <div className="flex items-start justify-between gap-3">
          <h2 className="ui-modal-title">Record Cashback</h2>
          <button onClick={onClose} aria-label="Close" className="ui-btn ui-btn-ghost ui-btn-icon shrink-0">
            <X size={22} aria-hidden="true" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label htmlFor="cashback-amount" className="ui-label">Amount (£)</label>
            <input
              id="cashback-amount"
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="e.g. 20.00"
              className="ui-input min-h-[64px] text-[28px] font-extrabold"
              autoFocus
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
              {saving ? 'Saving…' : 'Record'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
