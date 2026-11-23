import { useState } from 'react'
import { Banknote, CreditCard, Receipt, LogOut, Plus, Minus, X, Trash2, ChevronDown } from 'lucide-react'
import { useTillStore } from '../../stores/tillStore'
import { logEvent } from '../../lib/audit/log'
import CashPaymentModal from './CashPaymentModal'
import BlurredAmount from '../ui/BlurredAmount'

const money = n => Number(Number(n).toFixed(2))

// What an auditor needs to know about a line that left the order.
function lineDetail(line) {
  return {
    product: line.name,
    quantity: line.quantity,
    unit_price: line.unit_price,
    value: money(line.quantity * line.unit_price),
    ...(line.bundle_price_applied ? { bundle: true } : {}),
    ...(line.staff_credit_for ? { for_staff: line.staff_credit_name } : {}),
  }
}

export default function OrderPanel({ onCheckout, onClose }) {
  const { orderItems, activeMember, clearMember, updateQuantity, removeItem, getTotal, clearOrder } = useTillStore()
  const [paying, setPaying] = useState(false)
  const [showCashModal, setShowCashModal] = useState(false)
  const total = getTotal()

  async function handleCheckout(method) {
    setPaying(true)
    try { await onCheckout(method) }
    finally { setPaying(false) }
  }

  // ── Audit ───────────────────────────────────────────────────────────────
  // Order edits never reach the database (the cart lives in memory), so each
  // one is logged here. The store keys lines on line_id ?? product_id and a
  // shot-bundle line shares its key with a plain line for the same product,
  // so one tap can change two lines: read the affected lines BEFORE the
  // store action and log what actually happened to each.
  const linesFor = key =>
    useTillStore.getState().orderItems.filter(i => (i.line_id ?? i.product_id) === key)

  function handleRemove(lineKey) {
    const lines = linesFor(lineKey)
    removeItem(lineKey)
    lines.forEach(l => logEvent('cart.line_removed', lineDetail(l), { severity: 1 }))
  }

  function handleQuantity(lineKey, to) {
    const lines = linesFor(lineKey)
    updateQuantity(lineKey, to)
    lines.forEach(l => {
      if (to <= 0) {
        logEvent('cart.line_removed', lineDetail(l), { severity: 1 })
      } else if (to < l.quantity) {
        logEvent('cart.quantity_reduced', {
          product: l.name,
          from: l.quantity,
          to,
          value_removed: money((l.quantity - to) * l.unit_price),
          ...(l.bundle_price_applied ? { bundle: true } : {}),
          ...(l.staff_credit_for ? { for_staff: l.staff_credit_name } : {}),
        }, { severity: 1 })
      } else if (to > l.quantity && l.bundle_price_applied) {
        // More units at the deal price than the deal allows.
        logEvent('cart.bundle_quantity_increased', {
          product: l.name, from: l.quantity, to, unit_price: l.unit_price,
        }, { severity: 1 })
      }
    })
  }

  function handleVoidOrder() {
    const { orderItems: lines, activeMember: member } = useTillStore.getState()
    clearOrder()
    if (lines.length === 0) return
    logEvent('cart.order_voided', {
      lines: lines.length,
      value: money(lines.reduce((sum, l) => sum + l.subtotal, 0)),
      member: member?.name ?? null,
      member_id: member?.id ?? null,
      items: lines.slice(0, 30).map(l => ({ product: l.name, quantity: l.quantity, value: money(l.subtotal) })),
    }, { severity: 1 })
  }

  function handleClearMember() {
    const { orderItems: lines, activeMember: member, membersOnlyMode } = useTillStore.getState()
    clearMember()
    if (!member) return
    // Nothing is repriced when a member is cleared: lines already rung keep
    // the member price, and the sale then completes with no member on it.
    const kept = lines.filter(l => l.member_price_applied).length
    logEvent('cart.member_cleared', {
      member_id: member.id,
      member_name: member.name,
      lines_at_member_price: kept,
      ...(membersOnlyMode ? { members_only_mode: true } : {}),
    }, { severity: kept > 0 ? 1 : 0 })
  }

  return (
    <div className="flex flex-col bg-slate-900 border-l border-slate-800 w-72 xl:w-80 shrink-0">
      {onClose && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <span className="text-white font-semibold text-sm">Order</span>
          <button
            onClick={onClose}
            aria-label="Close order panel"
            className="w-11 h-11 flex items-center justify-center text-slate-400 hover:text-white
              transition-colors duration-200 cursor-pointer rounded-xl hover:bg-slate-800"
          >
            <ChevronDown size={20} aria-hidden="true" />
          </button>
        </div>
      )}
      {activeMember && (
        <div className="bg-blue-950 border-b border-blue-900 px-4 py-3 flex items-center justify-between">
          <div>
            <div className="text-blue-400 text-xs font-medium uppercase tracking-wider">Member</div>
            <div className="text-white font-semibold text-sm">{activeMember.name}</div>
            {Number(activeMember.tab_balance) > 0 && (
              <div className="text-blue-300 text-xs mt-0.5 flex items-center gap-1">
                <span>Tab:</span>
                {/* Capture phase: BlurredAmount stops the click from bubbling. */}
                <span
                  className="contents"
                  onClickCapture={() => logEvent('tab.amount_revealed', { member_id: activeMember.id })}
                >
                  <BlurredAmount className="text-blue-300">
                    £{Number(activeMember.tab_balance).toFixed(2)}
                  </BlurredAmount>
                </span>
              </div>
            )}
          </div>
          <button
            onClick={handleClearMember}
            aria-label="Clear member"
            className="flex items-center gap-1 text-slate-400 hover:text-white text-xs
              transition-colors duration-200 cursor-pointer min-h-[44px] px-2"
          >
            <LogOut size={14} aria-hidden="true" />
            Clear
          </button>
        </div>
      )}

      <div className="flex-1 overflow-auto p-3 space-y-2">
        {orderItems.length === 0 ? (
          <p className="text-slate-500 text-sm text-center mt-8">No items yet</p>
        ) : (
          orderItems.map(item => {
            // Staff-credit lines carry their own line_id so they never
            // collide with the buyer's own line for the same product.
            const lineKey = item.line_id ?? item.product_id
            return (
            <div key={lineKey} className="flex items-center gap-2 bg-slate-800 rounded-xl p-2">
              <div className="flex-1 min-w-0">
                <div className="text-white text-sm font-medium truncate">{item.name}</div>
                <div className="text-slate-400 text-xs">£{item.unit_price.toFixed(2)} each</div>
                {item.staff_credit_for && (
                  <div className="text-amber-400 text-xs font-medium">for {item.staff_credit_name} (staff)</div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleQuantity(lineKey, item.quantity - 1)}
                  aria-label="Decrease quantity"
                  className="w-11 h-11 rounded-lg bg-slate-700 hover:bg-slate-600 active:scale-95
                    text-white flex items-center justify-center transition-all duration-150 cursor-pointer"
                >
                  <Minus size={14} aria-hidden="true" />
                </button>
                <span className="w-6 text-center text-white text-sm font-medium">{item.quantity}</span>
                <button
                  onClick={() => handleQuantity(lineKey, item.quantity + 1)}
                  aria-label="Increase quantity"
                  className="w-11 h-11 rounded-lg bg-slate-700 hover:bg-slate-600 active:scale-95
                    text-white flex items-center justify-center transition-all duration-150 cursor-pointer"
                >
                  <Plus size={14} aria-hidden="true" />
                </button>
              </div>
              <button
                onClick={() => handleRemove(lineKey)}
                aria-label={`Remove ${item.name}`}
                className="w-11 h-11 flex items-center justify-center text-slate-500
                  hover:text-red-400 transition-colors duration-200 cursor-pointer rounded-lg"
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
            )
          })
        )}
      </div>

      <div className="border-t border-slate-800 p-4 space-y-3">
        <div className="flex justify-between items-center">
          <span className="text-slate-400 font-medium text-sm">Total</span>
          <span className="text-white text-2xl font-bold">£{total.toFixed(2)}</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[
            { method: 'cash', label: 'Cash', Icon: Banknote, cls: 'bg-emerald-700 hover:bg-emerald-600' },
            { method: 'card', label: 'Card', Icon: CreditCard, cls: 'bg-blue-700 hover:bg-blue-600' },
            { method: 'tab', label: 'Tab', Icon: Receipt, cls: 'bg-purple-700 hover:bg-purple-600', needsMember: true },
          ].map(({ method, label, Icon, cls, needsMember }) => (
            <button
              key={method}
              onClick={() => method === 'cash' ? setShowCashModal(true) : handleCheckout(method)}
              disabled={paying || orderItems.length === 0 || (needsMember && !activeMember)}
              className={`${cls} disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer
                text-white font-semibold py-3 rounded-xl text-sm transition-colors duration-200
                active:scale-95 flex flex-col items-center gap-1 min-h-[60px]`}
            >
              <Icon size={16} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
        {orderItems.length > 0 && (
          <button
            onClick={handleVoidOrder}
            className="w-full text-slate-500 hover:text-red-400 text-sm py-2
              transition-colors duration-200 cursor-pointer flex items-center justify-center gap-1"
          >
            <Trash2 size={14} aria-hidden="true" />
            Void Order
          </button>
        )}
      </div>
      {showCashModal && (
        <CashPaymentModal
          total={total}
          // onConfirm fires when user clicks Confirm — print/drawer happen now
          // so staff can give change with the drawer already open. Modal stays
          // visible showing the "Give change" amount until Done is clicked.
          onConfirm={() => handleCheckout('cash')}
          onCancel={() => setShowCashModal(false)}
          onDone={() => setShowCashModal(false)}
        />
      )}
    </div>
  )
}
