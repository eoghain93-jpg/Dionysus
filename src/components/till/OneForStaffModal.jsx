import { useState, useEffect } from 'react'
import { X } from '../../lib/icons'
import { fetchStaffMembers } from '../../lib/staffCredits'
import { useSessionStore } from '../../stores/sessionStore'

/**
 * "One in for yourself" — a customer buys a drink for a staff member.
 * Adds a staff-credit line to the current order: the customer pays for it
 * now as part of their round; the drink is banked for the staff member to
 * pour later (Staff Drink → Banked). Always standard price.
 *
 * Props:
 *   products — product list (same array the till grid uses)
 *   onAdd    — called with (product, staffMember) to add the basket line
 *   onClose  — close without adding
 */
export default function OneForStaffModal({ products, onAdd, onClose }) {
  const { activeStaff } = useSessionStore()
  const [staff, setStaff] = useState([])
  const [staffId, setStaffId] = useState('')
  const [productId, setProductId] = useState(products[0]?.id ?? '')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetchStaffMembers()
      .then(list => {
        if (cancelled) return
        setStaff(list)
        // Default to whoever is serving — "one for yourself" is usually them.
        const self = list.find(s => s.id === activeStaff?.id)
        setStaffId(self?.id ?? list[0]?.id ?? '')
      })
      .catch(() => { if (!cancelled) setError('Could not load staff list') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [activeStaff?.id])

  const product = products.find(p => p.id === productId)

  function handleAdd(e) {
    e.preventDefault()
    const member = staff.find(s => s.id === staffId)
    if (!member || !product) { setError('Pick a staff member and a drink'); return }
    onAdd(product, member)
  }

  return (
    <div
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="One for Staff"
    >
      <div className="bg-[#0F172A] border border-slate-700 rounded-2xl w-full max-w-sm p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-white font-bold text-lg">One for Staff</h2>
            <p className="text-slate-400 text-sm">Customer pays now — drink banked for later</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-white cursor-pointer">
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <form onSubmit={handleAdd} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="one-for-staff-member" className="text-slate-300 text-sm">For staff member</label>
            <select
              id="one-for-staff-member"
              value={staffId}
              onChange={e => setStaffId(e.target.value)}
              disabled={loading}
              className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            >
              {staff.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="one-for-staff-product" className="text-slate-300 text-sm">Drink</label>
            <select
              id="one-for-staff-product"
              value={productId}
              onChange={e => setProductId(e.target.value)}
              className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {products.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          {product && (
            <p className="text-slate-400 text-sm text-center">
              Adds <span className="text-white font-bold">£{Number(product.standard_price).toFixed(2)}</span> to this order
            </p>
          )}
          {error && <p role="alert" className="text-red-400 text-sm">{error}</p>}
          <div className="flex gap-2 mt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 min-h-[44px] rounded-xl border border-slate-600 text-slate-300 hover:bg-slate-700 text-sm font-medium cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !staffId}
              className="flex-1 min-h-[44px] rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold cursor-pointer transition-colors"
            >
              Add to Order
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
