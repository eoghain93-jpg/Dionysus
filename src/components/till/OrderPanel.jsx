import { useState, useEffect } from 'react'
import { Banknote, CreditCard, Receipt, Plus, Minus, ChevronDown, Clock, Lock, Check } from 'lucide-react'
import { useTillStore } from '../../stores/tillStore'
import { logEvent } from '../../lib/audit/log'
import CashPaymentModal from './CashPaymentModal'
import BlurredAmount from '../ui/BlurredAmount'

// How long "Confirm void" stays armed before it quietly stands down.
const VOID_ARM_MS = 3000

const PAYMENT_LABELS = { cash: 'cash', card: 'by card', tab: 'on tab' }

function initials(name) {
  return name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() ?? '?'
}

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

// A whole order, as it stood when it was voided or set aside.
function orderDetail(lines, member) {
  return {
    lines: lines.length,
    value: money(lines.reduce((sum, l) => sum + l.subtotal, 0)),
    member: member?.name ?? null,
    member_id: member?.id ?? null,
    items: lines.slice(0, 30).map(l => ({ product: l.name, quantity: l.quantity, value: money(l.subtotal) })),
  }
}

/**
 * @param {object[]} [products]    - used to work out the member saving
 * @param {object[]} [usual]       - the active member's usual: [{ product, quantity }]
 * @param {function} [onAddUsual]
 * @param {function} [onSameAgain] - repeat the last completed sale
 * @param {function} [onFixPayment] - open the recent-sales screen
 */
export default function OrderPanel({
  onCheckout, onClose, products = [], usual = [], onAddUsual, onSameAgain, onFixPayment,
}) {
  const {
    orderItems, activeMember, activeMemberTab, clearMember, updateQuantity, getTotal, clearOrder,
    parkedOrders, parkOrder, resumeOrder, lastSale,
  } = useTillStore()
  const [paying, setPaying] = useState(false)
  const [showCashModal, setShowCashModal] = useState(false)
  const [voidArmed, setVoidArmed] = useState(false)
  const total = getTotal()
  const tabBlocked = !!activeMember?.tab_blocked
  const hasItems = orderItems.length > 0
  const itemCount = orderItems.reduce((sum, i) => sum + i.quantity, 0)

  // Void takes two taps. The first arms it; it disarms on its own, and
  // whenever the order changes, so a stray touch can never wipe an order.
  useEffect(() => {
    if (!voidArmed) return
    const timer = setTimeout(() => setVoidArmed(false), VOID_ARM_MS)
    return () => clearTimeout(timer)
  }, [voidArmed])
  useEffect(() => { setVoidArmed(false) }, [orderItems])

  // What the member has saved against standard prices on this order.
  const saving = orderItems.reduce((sum, item) => {
    if (!item.member_price_applied) return sum
    const product = products.find(p => p.id === item.product_id)
    return product ? sum + (product.standard_price - item.unit_price) * item.quantity : sum
  }, 0)

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

  // Void takes two taps (see above); only the second one voids and is logged.
  function handleVoid() {
    if (!voidArmed) { setVoidArmed(true); return }
    setVoidArmed(false)
    const { orderItems: lines, activeMember: member } = useTillStore.getState()
    clearOrder()
    if (lines.length === 0) return
    logEvent('cart.order_voided', orderDetail(lines, member), { severity: 1 })
  }

  // A parked order lives only in this till's memory until it is resumed and
  // paid, so the log is the only record of what was set aside — and of a
  // parked order that never comes back.
  function handlePark() {
    const { orderItems: lines, activeMember: member } = useTillStore.getState()
    if (lines.length === 0) return
    parkOrder()
    const parked = useTillStore.getState().parkedOrders.at(-1)
    logEvent('cart.order_parked', { park_id: parked?.id ?? null, label: parked?.label ?? null, ...orderDetail(lines, member) })
  }

  function handleResume(id) {
    const before = useTillStore.getState()
    const parked = before.parkedOrders.find(p => p.id === id)
    if (!parked) return
    const { orderItems: lines, activeMember: member } = before
    resumeOrder(id)
    // Whatever was on the till is parked in its place by the store.
    if (lines.length > 0) {
      const swapped = useTillStore.getState().parkedOrders.at(-1)
      logEvent('cart.order_parked', {
        park_id: swapped?.id ?? null, label: swapped?.label ?? null, swapped_for: id, ...orderDetail(lines, member),
      })
    }
    logEvent('cart.order_resumed', { park_id: id, label: parked.label, ...orderDetail(parked.items, parked.member) })
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
    <div className="flex flex-col bg-slate-900 border-l border-slate-800 w-full md:w-80 lg:w-[380px] shrink-0">
      <div className="flex items-center gap-2.5 pl-5 pr-4 pt-4 pb-3 min-h-[48px]">
        <h2 className="text-white text-[22px] font-extrabold">Order</h2>
        {hasItems && !voidArmed && (
          <span className="text-slate-400 text-[15px]">
            {itemCount} {itemCount === 1 ? 'item' : 'items'}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {hasItems && (
            <>
              <button
                onClick={handlePark}
                className="min-h-[44px] px-3.5 rounded-xl border border-slate-700 text-slate-100 text-sm font-bold
                  hover:bg-slate-800 transition-colors cursor-pointer"
              >
                Park
              </button>
              <button
                onClick={handleVoid}
                className={`min-h-[44px] px-3.5 rounded-xl border text-sm font-bold whitespace-nowrap
                  transition-colors cursor-pointer
                  ${voidArmed
                    ? 'bg-red-300 border-red-300 text-[#121314]'
                    : 'border-slate-700 text-red-300 hover:bg-slate-800'}`}
              >
                {voidArmed ? 'Confirm void' : 'Void'}
              </button>
            </>
          )}
          {onClose && (
            <button
              onClick={onClose}
              aria-label="Close order panel"
              className="w-11 h-11 flex items-center justify-center text-slate-400 hover:text-white
                transition-colors duration-200 cursor-pointer rounded-xl hover:bg-slate-800"
            >
              <ChevronDown size={20} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {parkedOrders.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
          <span className="text-slate-400 text-[13px] font-bold">Parked</span>
          {parkedOrders.map(parked => {
            const parkedTotal = parked.items.reduce((sum, i) => sum + i.subtotal, 0)
            return (
              <button
                key={parked.id}
                onClick={() => handleResume(parked.id)}
                aria-label={`Resume parked order ${parked.label}, £${parkedTotal.toFixed(2)}`}
                className="min-h-[44px] px-3.5 rounded-full border border-slate-700 bg-slate-800 text-slate-100
                  text-sm font-bold whitespace-nowrap hover:bg-slate-700 transition-colors cursor-pointer"
              >
                {parked.label} · £{parkedTotal.toFixed(2)}
              </button>
            )
          })}
        </div>
      )}

      {activeMember ? (
        <div className="mx-4 rounded-2xl bg-blue-950 border border-blue-900 pl-3.5 pr-2 py-2.5 flex flex-col gap-1.5">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="w-10 h-10 shrink-0 rounded-full bg-blue-600 text-white text-[15px] font-extrabold
                flex items-center justify-center"
            >
              {initials(activeMember.name)}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-blue-300 text-xs font-bold uppercase tracking-wider">Member</div>
              <div className="text-white font-bold text-[17px] leading-tight truncate">{activeMember.name}</div>
              {Number(activeMember.tab_balance) > 0 && (
                <div className="text-blue-300 text-sm mt-0.5 flex items-center gap-1">
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
              className="min-h-[44px] px-3 rounded-xl text-slate-100 text-sm font-bold
                hover:bg-blue-900 transition-colors cursor-pointer"
            >
              Remove
            </button>
          </div>
          {tabBlocked && (
            <div className="mr-1.5 rounded-xl bg-[#121314] px-2.5 py-2 text-red-300 text-sm font-bold flex items-center gap-2">
              <Lock size={15} aria-hidden="true" />
              <span>Tab blocked — cash or card only</span>
            </div>
          )}
          {activeMemberTab?.overdue && (
            <div className="mr-1.5 rounded-xl bg-[#121314] px-2.5 py-2 text-amber-300 text-sm font-bold flex items-center gap-2">
              <Clock size={15} aria-hidden="true" />
              <span>No tab payment for {activeMemberTab.days} days</span>
            </div>
          )}
          {usual.length > 0 && onAddUsual && (
            <button
              onClick={onAddUsual}
              className="mr-1.5 min-h-[52px] rounded-xl bg-[#121314] hover:bg-slate-800 px-3 py-1.5 text-left
                flex items-center gap-2.5 transition-colors cursor-pointer"
            >
              <span className="flex-1 min-w-0">
                <span className="block text-slate-400 text-xs font-bold">The usual</span>
                <span className="block text-white text-[15px] font-bold truncate">
                  {usual.map(u => `${u.quantity} × ${u.product.name}`).join(', ')}
                </span>
              </span>
              <span className="text-blue-300 text-sm font-extrabold">Add</span>
            </button>
          )}
        </div>
      ) : (
        <div className="mx-4 rounded-2xl border-[1.5px] border-dashed border-slate-700 px-3.5 py-3 text-sm text-slate-400 leading-snug">
          <strong className="block text-slate-100 text-[15px]">No member on this sale</strong>
          Standard prices. Find a member for their price and tab.
        </div>
      )}

      <div className="flex-1 overflow-auto px-4 py-3 flex flex-col gap-2 min-h-[120px]">
        {!hasItems && lastSale ? (
          <div role="status" className="m-auto flex flex-col items-center gap-2.5 text-center">
            <span aria-hidden="true" className="w-14 h-14 rounded-full bg-emerald-700 flex items-center justify-center">
              <Check size={28} strokeWidth={3} className="text-white" />
            </span>
            <div className="text-white text-xl font-extrabold">Sale complete</div>
            <div className="text-slate-400 text-[15px]">
              £{lastSale.total.toFixed(2)} {PAYMENT_LABELS[lastSale.paymentMethod] ?? lastSale.paymentMethod}
              {lastSale.member ? ` · ${lastSale.member.name}` : ''}
            </div>
            <div className="flex gap-2 mt-2">
              {onSameAgain && (
                <button
                  onClick={onSameAgain}
                  className="min-h-[52px] px-5 rounded-2xl bg-slate-100 text-[#121314] text-base font-extrabold
                    hover:bg-white transition-colors cursor-pointer"
                >
                  Same again
                </button>
              )}
              {onFixPayment && (
                <button
                  onClick={onFixPayment}
                  className="min-h-[52px] px-4 rounded-2xl border border-slate-700 text-slate-100 text-[15px] font-bold
                    hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  Wrong payment?
                </button>
              )}
            </div>
          </div>
        ) : !hasItems ? (
          <p className="m-auto text-slate-400 text-base text-center leading-normal">
            Nothing on the order yet.<br />Tap a drink to start.
          </p>
        ) : (
          orderItems.map(item => {
            // Staff-credit lines carry their own line_id so they never
            // collide with the buyer's own line for the same product.
            const lineKey = item.line_id ?? item.product_id
            return (
              <div key={lineKey} className="flex items-center gap-2 bg-slate-800 rounded-2xl pl-1.5 pr-3 py-1.5">
                <button
                  onClick={() => handleQuantity(lineKey, item.quantity - 1)}
                  aria-label={item.quantity === 1 ? `Remove ${item.name}` : 'Decrease quantity'}
                  className="w-11 h-11 shrink-0 rounded-xl bg-slate-700 hover:bg-slate-600 active:scale-95
                    text-white flex items-center justify-center transition-all duration-150 cursor-pointer"
                >
                  <Minus size={18} aria-hidden="true" />
                </button>
                <span className="w-6 text-center text-white text-lg font-extrabold">{item.quantity}</span>
                <button
                  onClick={() => handleQuantity(lineKey, item.quantity + 1)}
                  aria-label="Increase quantity"
                  className="w-11 h-11 shrink-0 rounded-xl bg-slate-700 hover:bg-slate-600 active:scale-95
                    text-white flex items-center justify-center transition-all duration-150 cursor-pointer"
                >
                  <Plus size={18} aria-hidden="true" />
                </button>
                <div className="flex-1 min-w-0 pl-1">
                  <div className="text-white text-base font-semibold truncate">{item.name}</div>
                  <div className="text-slate-400 text-[13px]">£{item.unit_price.toFixed(2)} each</div>
                  {item.staff_credit_for && (
                    <div className="text-amber-400 text-xs font-medium">for {item.staff_credit_name} (staff)</div>
                  )}
                </div>
                <span className="text-white text-[17px] font-extrabold">£{item.subtotal.toFixed(2)}</span>
              </div>
            )
          })
        )}
      </div>

      <div className="border-t border-slate-800 px-4 pt-3.5 pb-4 flex flex-col gap-2.5">
        {hasItems && saving > 0.001 && (
          <div className="flex justify-between text-emerald-300 text-[15px] font-bold">
            <span>Member saving</span>
            <span>−£{saving.toFixed(2)}</span>
          </div>
        )}
        <div className="flex justify-between items-baseline">
          <span className="text-slate-400 font-semibold text-base">Total</span>
          <span className="text-white text-[44px] leading-none font-extrabold tracking-tight">£{total.toFixed(2)}</span>
        </div>
        <div className="grid grid-cols-3 gap-2.5">
          {[
            { method: 'cash', label: 'Cash', Icon: Banknote, cls: 'bg-emerald-700 hover:bg-emerald-600 text-white' },
            { method: 'card', label: 'Card', Icon: CreditCard, cls: 'bg-slate-100 hover:bg-white text-[#121314]' },
            { method: 'tab', label: 'Tab', Icon: Receipt, cls: 'bg-blue-600 hover:bg-blue-500 text-white', needsMember: true },
          ].map(({ method, label, Icon, cls, needsMember }) => (
            <button
              key={method}
              onClick={() => method === 'cash' ? setShowCashModal(true) : handleCheckout(method)}
              disabled={paying || !hasItems || (needsMember && (!activeMember || tabBlocked))}
              className={`${cls} disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer
                font-extrabold rounded-2xl text-lg transition-colors duration-200
                active:scale-95 flex flex-col items-center justify-center gap-1 min-h-[76px]`}
            >
              <Icon size={22} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
        <p className={`text-sm font-semibold text-center min-h-[20px] ${tabBlocked ? 'text-red-300' : 'text-slate-400'}`}>
          {tabBlocked ? 'Take cash or card for this sale' : !activeMember ? 'Add a member to use Tab' : ''}
        </p>
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
