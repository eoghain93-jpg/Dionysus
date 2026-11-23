import { useState, useEffect, useCallback } from 'react'
import { X, Banknote, CreditCard, Receipt, ArrowLeftRight, Undo2 } from 'lucide-react'
import { fetchTodaysOrders, correctOrderPaymentMethod, undoTabSettlement } from '../../lib/orders'
import { useSessionStore } from '../../stores/sessionStore'
import { useToastStore } from '../../hooks/useToast'
import PinGate from './PinGate'

const METHOD_STYLE = {
  cash: { label: 'Cash', Icon: Banknote, cls: 'ui-tag-good' },
  card: { label: 'Card', Icon: CreditCard, cls: 'ui-tag-accent' },
  tab:  { label: 'Tab',  Icon: Receipt, cls: 'bg-slate-700 text-slate-100' },
}

function timeOf(ts) {
  return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

/**
 * RecentSalesModal — today's sales with PIN-gated cash<->card correction
 * and undo for tab payments.
 *
 * For the recurring "rang it as card but it was cash" mistake: staff fix it
 * themselves instead of phoning the manager. Server-side guard rails (same
 * trading day, day not closed, cash<->card only) live in the
 * correct_order_payment_method RPC; this UI just surfaces them calmly.
 *
 * Undo is for a tab settled for the wrong amount (e.g. "Full balance"
 * tapped when only part was paid): the undo_tab_settlement RPC reverses the
 * whole payment, then staff settle the amount actually handed over.
 */
export default function RecentSalesModal({ onClose }) {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // { type: 'fix', order, newMethod } | { type: 'undo', order } while the
  // PIN gate is up
  const [pending, setPending] = useState(null)
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

  async function applyPending() {
    if (pending.type === 'undo') return applyUndo()
    const { order, newMethod } = pending
    setPending(null)
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

  async function applyUndo() {
    const { order } = pending
    setPending(null)
    setFixingId(order.id)
    try {
      await undoTabSettlement(order.id, activeStaff?.id)
      useToastStore.getState().addToast(
        `£${Number(order.total_amount).toFixed(2)} put back on ${order.members?.name ? `${order.members.name}’s` : 'the'} tab — now settle what was actually paid`,
        'success',
      )
      loadOrders()
    } catch (err) {
      useToastStore.getState().addToast(err.message ?? 'Could not undo tab payment', 'error')
    } finally {
      setFixingId(null)
    }
  }

  return (
    <div
      className="ui-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Recent sales"
    >
      <div className="ui-modal max-w-lg overflow-hidden px-4 sm:px-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="ui-modal-title">Recent Sales</h2>
            <p className="ui-subtitle mt-1">Wrong payment type or tab amount? Fix it here — today only.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="ui-btn ui-btn-ghost ui-btn-icon shrink-0">
            <X size={22} aria-hidden="true" />
          </button>
        </div>

        {loading && <p className="ui-empty">Loading today’s sales…</p>}
        {error && <p role="alert" className="ui-banner ui-banner-bad">{error}</p>}
        {!loading && !error && orders.length === 0 && (
          <p className="ui-empty">No sales yet today</p>
        )}

        <div className="min-h-0 overflow-auto flex flex-col gap-2">
          {orders.map(o => {
            const style = METHOD_STYLE[o.payment_method] ?? METHOD_STYLE.cash
            const correctable = o.payment_method === 'cash' || o.payment_method === 'card'
            const newMethod = o.payment_method === 'cash' ? 'card' : 'cash'
            return (
              <div key={o.id} className="flex flex-col gap-2 bg-slate-800 rounded-2xl px-3 sm:px-4 py-2.5">
                <div className="flex items-center gap-2.5 sm:gap-3">
                  <span className="text-slate-300 text-[15px] font-semibold w-12 shrink-0">{timeOf(o.created_at)}</span>
                  <span className="text-white text-xl font-extrabold flex-1">
                    £{Number(o.total_amount).toFixed(2)}
                  </span>
                  <span className={`ui-tag ${style.cls}`}>
                    <style.Icon size={15} aria-hidden="true" />
                    {style.label}
                  </span>
                  {correctable ? (
                    <button
                      onClick={() => setPending({ type: 'fix', order: o, newMethod })}
                      disabled={fixingId === o.id}
                      aria-label={`Switch ${timeOf(o.created_at)} sale to ${METHOD_STYLE[newMethod].label}`}
                      className="ui-btn px-3 bg-slate-700 text-white hover:bg-slate-600"
                    >
                      <ArrowLeftRight size={16} aria-hidden="true" />
                      {fixingId === o.id ? 'Fixing…' : `To ${METHOD_STYLE[newMethod].label}`}
                    </button>
                  ) : (
                    <span className="text-slate-400 text-[15px] px-1">Ask manager</span>
                  )}
                </div>
                {o.is_tab_settlement && (
                  <div className="flex items-center gap-3">
                    <span className="text-slate-300 text-[15px] flex-1 min-w-0 truncate">
                      Tab payment · {o.members?.name ?? 'member'}
                    </span>
                    <button
                      onClick={() => setPending({ type: 'undo', order: o })}
                      disabled={fixingId === o.id}
                      aria-label={`Undo ${timeOf(o.created_at)} tab payment`}
                      className="ui-btn px-3 border border-amber-800 bg-amber-950 text-amber-200 hover:bg-amber-900"
                    >
                      <Undo2 size={16} aria-hidden="true" />
                      Undo
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {pending && (
        <PinGate
          label={pending.type === 'undo' ? 'Undo Tab Payment' : 'Fix Payment'}
          onConfirm={applyPending}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  )
}
