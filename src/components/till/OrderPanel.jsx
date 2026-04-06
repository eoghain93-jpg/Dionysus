import { useState } from 'react'
import { Banknote, CreditCard, Receipt, LogOut, Plus, Minus, X, Trash2, ChevronDown } from 'lucide-react'
import { useTillStore } from '../../stores/tillStore'
import CashPaymentModal from './CashPaymentModal'

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
          </div>
          <button
            onClick={clearMember}
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
          orderItems.map(item => (
            <div key={item.product_id} className="flex items-center gap-2 bg-slate-800 rounded-xl p-2">
              <div className="flex-1 min-w-0">
                <div className="text-white text-sm font-medium truncate">{item.name}</div>
                <div className="text-slate-400 text-xs">£{item.unit_price.toFixed(2)} each</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => updateQuantity(item.product_id, item.quantity - 1)}
                  aria-label="Decrease quantity"
                  className="w-11 h-11 rounded-lg bg-slate-700 hover:bg-slate-600 active:scale-95
                    text-white flex items-center justify-center transition-all duration-150 cursor-pointer"
                >
                  <Minus size={14} aria-hidden="true" />
                </button>
                <span className="w-6 text-center text-white text-sm font-medium">{item.quantity}</span>
                <button
                  onClick={() => updateQuantity(item.product_id, item.quantity + 1)}
                  aria-label="Increase quantity"
                  className="w-11 h-11 rounded-lg bg-slate-700 hover:bg-slate-600 active:scale-95
                    text-white flex items-center justify-center transition-all duration-150 cursor-pointer"
                >
                  <Plus size={14} aria-hidden="true" />
                </button>
              </div>
              <button
                onClick={() => removeItem(item.product_id)}
                aria-label={`Remove ${item.name}`}
                className="w-11 h-11 flex items-center justify-center text-slate-500
                  hover:text-red-400 transition-colors duration-200 cursor-pointer rounded-lg"
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          ))
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
            onClick={clearOrder}
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
          onConfirm={() => { setShowCashModal(false); handleCheckout('cash') }}
          onCancel={() => setShowCashModal(false)}
        />
      )}
    </div>
  )
}
