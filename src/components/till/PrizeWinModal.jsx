import { useState } from 'react'
import { X } from '../../lib/icons'
import { recordPrizeWin } from '../../lib/prizeWins'
import { useSessionStore } from '../../stores/sessionStore'
import { openDrawer } from '../../lib/starPrinter'
import { useToastStore } from '../../hooks/useToast'

/**
 * PrizeWinModal — records a fruit-machine voucher payout.
 * Customer hands over a paper voucher; staff enters amount + machine,
 * drawer opens, staff pays out cash equal to the voucher value.
 *
 * Mirrors CashbackModal but adds a machine selector.
 */
export default function PrizeWinModal({ onClose, onSaved }) {
  const { activeStaff } = useSessionStore()
  const addToast = useToastStore(s => s.addToast)
  const [amount, setAmount] = useState('')
  const [machine, setMachine] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    const val = parseFloat(amount)
    if (!val || val <= 0) { setError('Enter a valid amount'); return }
    if (!machine) { setError('Select a machine'); return }
    setSaving(true)
    setError(null)
    try {
      await recordPrizeWin(val, machine, activeStaff?.id)
      try {
        await openDrawer()
      } catch {
        addToast('Drawer failed — use manual open in Settings', 'error')
      }
      onSaved()
    } catch (err) {
      setError(err.message ?? 'Failed to record prize win')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="ui-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Record Prize Win"
    >
      <div className="ui-modal">
        <div className="flex items-start justify-between gap-3">
          <h2 className="ui-modal-title">Record Prize Win</h2>
          <button onClick={onClose} aria-label="Close" className="ui-btn ui-btn-ghost ui-btn-icon shrink-0">
            <X size={22} aria-hidden="true" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label htmlFor="prize-amount" className="ui-label">Voucher amount (£)</label>
            <input
              id="prize-amount"
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="e.g. 5.00"
              className="ui-input min-h-[64px] text-[28px] font-extrabold"
              autoFocus
            />
          </div>

          <fieldset>
            <legend className="ui-label">Machine</legend>
            <div className="grid grid-cols-2 gap-2.5">
              {['1', '2'].map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMachine(m)}
                  aria-pressed={machine === m}
                  className={`ui-tab min-h-[64px] rounded-2xl text-[17px] ${machine === m ? 'ui-tab-active' : ''}`}
                >
                  Machine {m}
                </button>
              ))}
            </div>
          </fieldset>

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
