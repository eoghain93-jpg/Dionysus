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
      className="ui-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="One for Staff"
    >
      <div className="ui-modal max-w-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="ui-modal-title">One for Staff</h2>
            <p className="ui-subtitle">Customer pays now — drink banked for later</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="ui-btn ui-btn-ghost ui-btn-icon shrink-0">
            <X size={22} aria-hidden="true" />
          </button>
        </div>
        <form onSubmit={handleAdd} className="flex flex-col gap-4">
          <div>
            <label htmlFor="one-for-staff-member" className="ui-label">For staff member</label>
            <select
              id="one-for-staff-member"
              value={staffId}
              onChange={e => setStaffId(e.target.value)}
              disabled={loading}
              className="ui-select w-full font-semibold disabled:opacity-50"
            >
              {staff.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="one-for-staff-product" className="ui-label">Drink</label>
            <select
              id="one-for-staff-product"
              value={productId}
              onChange={e => setProductId(e.target.value)}
              className="sr-only"
            >
              {products.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-[38dvh] overflow-auto -m-1 p-1">
              {products.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setProductId(p.id)}
                  aria-pressed={p.id === productId}
                  className={`${PICK_TILE} ${p.id === productId ? PICK_TILE_ON : PICK_TILE_OFF}`}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>
          {product && (
            <p className="bg-slate-800 rounded-2xl px-4 py-3 text-slate-300 text-base text-center">
              Adds <span className="text-white text-xl font-extrabold">£{Number(product.standard_price).toFixed(2)}</span> to this order
            </p>
          )}
          {error && <p role="alert" className="ui-error">{error}</p>}
          <div className="ui-modal-actions">
            <button
              type="button"
              onClick={onClose}
              className="ui-btn ui-btn-ghost ui-btn-lg flex-1"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !staffId}
              className="ui-btn ui-btn-primary ui-btn-lg flex-1"
            >
              Add to Order
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// Product tiles in the till's style. The labelled <select> stays in the DOM
// (visually hidden) as the real form control; the tiles drive the same state.
const PICK_TILE = `min-h-[64px] rounded-2xl border-[1.5px] px-3.5 py-2.5 text-left text-[17px] leading-tight
  font-semibold cursor-pointer transition-transform duration-100 active:scale-[0.97]
  focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400`
const PICK_TILE_ON = 'bg-blue-950 border-blue-400 text-white'
const PICK_TILE_OFF = 'bg-slate-800 border-slate-700 text-slate-100 hover:bg-slate-700'
