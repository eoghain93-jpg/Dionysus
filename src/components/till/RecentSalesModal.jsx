import { useState, useEffect, useCallback } from 'react'
import { X, Banknote, CreditCard, Receipt, ArrowLeftRight } from 'lucide-react'
import { fetchTodaysOrders, correctOrderPaymentMethod } from '../../lib/orders'
import { useSessionStore } from '../../stores/sessionStore'
import { useToastStore } from '../../hooks/useToast'
import PinGate from './PinGate'

const METHOD_STYLE = {
  cash: { label: 'Cash', Icon: Banknote, cls: 'bg-emerald-900/60 text-emerald-300 border-emerald-700/50' },
  card: { label: 'Card', Icon: CreditCard, cls: 'bg-blue-900/60 text-blue-300 border-blue-700/50' },
  tab:  { label: 'Tab',  Icon: Receipt, cls: 'bg-purple-900/60 text-purple-300 border-purple-700/50' },
}

function timeOf(ts) {
  return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

/**
 * RecentSalesModal — today's sales with PIN-gated cash<->card correction.
 *
 * For the recurring "rang it as card but it was cash" mistake: staff fix it
 * themselves instead of phoning the manager. Server-side guard rails (same
 * trading day, day not closed, cash<->card only) live in the
 * correct_order_payment_method RPC; this UI just surfaces them calmly.
 */
export default function RecentSalesModal({ onClose }) {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // { order, newMethod } while the PIN gate is up
  const [pendingFix, setPendingFix] = useState(null)
  const [fixingId, setFixingId] = useState(null)
  const activeStaff = useSessionStore(s => s.activeStaff)

  const loadOrders = useCallback(() => {
    setLoading(true)
    setError(null)
    fetchTodaysOrders()
      .then(setOrders)
      .catch(err => setError(err.message ?? 'Could not load today’s sales'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { loadOrders() }, [loadOrders])

  async function applyFix() {
    const { order, newMethod } = pendingFix
    setPendingFix(null)
    setFixingId(order.id)
    try {
      await correctOrderPaymentMethod(order.id, newMethod, activeStaff?.id)
      useToastStore.getState().addToast(
        `Sale at ${timeOf(order.created_at)} switched to ${METHOD_STYLE[newMethod].label}`,
        'success',
      )
      loadOrders()
    } catch (err) {
      // RPC guard messages are written for staff ("today has already been
      // closed — ask the manager") — show them as-is
      useToastStore.getState().addToast(err.message ?? 'Could not fix payment', 'error')
    } finally {
      setFixingId(null)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Recent sales"
    >
      <div className="bg-[#0F172A] border border-slate-700 rounded-2xl w-full max-w-md p-5 flex flex-col gap-4 max-h-[85dvh]">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-white font-bold text-lg">Recent Sales</h2>
            <p className="text-slate-400 text-xs">Wrong payment type? Switch it here — today only.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-white cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center">
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        {loading && <p className="text-slate-400 text-sm text-center py-6">Loading today’s sales…</p>}
        {error && <p role="alert" className="text-red-400 text-sm text-center">{error}</p>}
        {!loading && !error && orders.length === 0 && (
          <p className="text-slate-500 text-sm text-center py-6">No sales yet today</p>
        )}

        <div className="overflow-auto flex flex-col gap-2">
          {orders.map(o => {
            const style = METHOD_STYLE[o.payment_method] ?? METHOD_STYLE.cash
            const correctable = o.payment_method === 'cash' || o.payment_method === 'card'
            const newMethod = o.payment_method === 'cash' ? 'card' : 'cash'
            return (
              <div key={o.id} className="flex items-center gap-3 bg-slate-800 rounded-xl px-3 py-2">
                <span className="text-slate-400 text-sm tabular-nums w-12">{timeOf(o.created_at)}</span>
                <span className="text-white font-semibold tabular-nums flex-1">
                  £{Number(o.total_amount).toFixed(2)}
                </span>
                <span className={`flex items-center gap-1 text-xs font-medium border rounded-lg px-2 py-1 ${style.cls}`}>
                  <style.Icon size={12} aria-hidden="true" />
                  {style.label}
                </span>
                {correctable ? (
                  <button
                    onClick={() => setPendingFix({ order: o, newMethod })}
                    disabled={fixingId === o.id}
                    aria-label={`Switch ${timeOf(o.created_at)} sale to ${METHOD_STYLE[newMethod].label}`}
                    className="flex items-center gap-1.5 min-h-[40px] px-3 rounded-lg bg-slate-700 hover:bg-slate-600
                      disabled:opacity-50 text-white text-xs font-semibold cursor-pointer transition-colors"
                  >
                    <ArrowLeftRight size={12} aria-hidden="true" />
                    {fixingId === o.id ? 'Fixing…' : `To ${METHOD_STYLE[newMethod].label}`}
                  </button>
                ) : (
                  <span className="text-slate-500 text-xs px-2">Ask manager</span>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {pendingFix && (
        <PinGate
          label="Fix Payment"
          onConfirm={applyFix}
          onCancel={() => setPendingFix(null)}
        />
      )}
    </div>
  )
}
