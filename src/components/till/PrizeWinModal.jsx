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
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Record Prize Win"
    >
      <div className="bg-[#0F172A] border border-slate-700 rounded-2xl w-full max-w-sm p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-white font-bold text-lg">Record Prize Win</h2>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-white cursor-pointer">
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="prize-amount" className="text-slate-300 text-sm">Voucher amount (£)</label>
            <input
              id="prize-amount"
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="e.g. 5.00"
              className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
          </div>

          <fieldset className="flex flex-col gap-1">
            <legend className="text-slate-300 text-sm mb-1">Machine</legend>
            <div className="grid grid-cols-2 gap-2">
              {['1', '2'].map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMachine(m)}
                  aria-pressed={machine === m}
                  className={`min-h-[44px] rounded-xl border text-sm font-semibold transition-colors cursor-pointer ${
                    machine === m
                      ? 'bg-blue-600 border-blue-500 text-white'
                      : 'bg-slate-800 border-slate-600 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  Machine {m}
                </button>
              ))}
            </div>
          </fieldset>

          {error && <p role="alert" className="text-red-400 text-sm">{error}</p>}
          <div className="flex gap-2 mt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 min-h-[44px] rounded-xl border border-slate-600 text-slate-300 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 min-h-[44px] rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold cursor-pointer transition-colors"
            >
              {saving ? 'Saving…' : 'Record'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
