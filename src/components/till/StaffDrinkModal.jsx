import { useState, useEffect } from 'react'
import { X } from '../../lib/icons'
import { logStaffDrink } from '../../lib/stockMovements'
import { fetchStaffMembers, fetchBankedCredits, redeemCredit } from '../../lib/staffCredits'
import { useSessionStore } from '../../stores/sessionStore'

export default function StaffDrinkModal({ products, onClose, onSaved }) {
  const { activeStaff } = useSessionStore()
  const [productId, setProductId] = useState(products[0]?.id ?? '')
  const [quantity, setQuantity] = useState(1)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  // The drink can be for someone other than who's logged in — an off-shift
  // colleague on the customer side claiming their banked pints, or a comp
  // logged on their behalf. Defaults to the person working. If the staff
  // list can't load (offline), the picker falls back to just activeStaff so
  // free-drink logging still works.
  const [staff, setStaff] = useState(activeStaff ? [activeStaff] : [])
  const [staffId, setStaffId] = useState(activeStaff?.id ?? '')
  // Banked drinks ("one in for yourself") for the SELECTED staff member,
  // oldest first. Redeeming pours the chosen product and consumes the oldest
  // credit — already paid for by a customer, so no money moves.
  const [credits, setCredits] = useState([])

  useEffect(() => {
    let cancelled = false
    fetchStaffMembers()
      .then(list => {
        if (cancelled || !list.length) return
        setStaff(list)
      })
      .catch(err => {
        console.error('Failed to load staff list:', err)
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!staffId) return
    let cancelled = false
    fetchBankedCredits(staffId)
      .then(rows => {
        if (cancelled) return
        setCredits(rows)
        // Default the picker to what was bought for the oldest credit so a
        // single tap on Redeem decrements the right product's stock. Staff
        // can still change it to whatever they actually pour.
        const bought = rows[0]?.product_id
        if (bought && products.some(p => p.id === bought)) setProductId(bought)
      })
      .catch(err => {
        // Non-blocking: the free-drink form still works offline; banked
        // redemption needs the server anyway.
        console.error('Failed to load banked drinks:', err)
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staffId])

  const selectedStaff = staff.find(s => s.id === staffId)

  async function handleSubmit(e) {
    e.preventDefault()
    const qty = parseInt(quantity, 10)
    if (!qty || qty <= 0) { setError('Enter a valid quantity'); return }
    setSaving(true)
    setError(null)
    try {
      await logStaffDrink(productId, qty, staffId)
      onSaved()
    } catch (err) {
      setError(err.message ?? 'Failed to log staff drink')
    } finally {
      setSaving(false)
    }
  }

  async function handleRedeem() {
    const oldest = credits[0]
    if (!oldest) return
    setSaving(true)
    setError(null)
    try {
      // The credit belongs to the selected staff member; redeemed_by records
      // who was actually working the till and poured it.
      await redeemCredit(oldest.id, productId, activeStaff?.id)
      onSaved()
    } catch (err) {
      setError(err.message ?? 'Failed to redeem banked drink')
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Staff Drink"
    >
      <div className="bg-[#0F172A] border border-slate-700 rounded-2xl w-full max-w-sm p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-white font-bold text-lg">Staff Drink</h2>
            <p className="text-slate-400 text-sm">{activeStaff?.name}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-white cursor-pointer">
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="staff-drink-who" className="text-slate-300 text-sm">Whose drink?</label>
          <select
            id="staff-drink-who"
            value={staffId}
            onChange={e => setStaffId(e.target.value)}
            className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {staff.map(s => (
              <option key={s.id} value={s.id}>{s.name}{s.id === activeStaff?.id ? ' (you)' : ''}</option>
            ))}
          </select>
        </div>

        {credits.length > 0 && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 flex flex-col gap-2">
            <p className="text-amber-400 text-sm font-bold">
              {selectedStaff?.id === activeStaff?.id
                ? `${credits.length} banked drink${credits.length === 1 ? '' : 's'} waiting`
                : `${selectedStaff?.name} has ${credits.length} banked drink${credits.length === 1 ? '' : 's'}`}
            </p>
            <p className="text-slate-400 text-xs">
              Bought by customers — pick the drink being poured below, then redeem.
            </p>
            <button
              type="button"
              onClick={handleRedeem}
              disabled={saving}
              className="min-h-[44px] rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-900 text-sm font-bold cursor-pointer transition-colors"
            >
              Redeem 1 Banked Drink
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="staff-drink-product" className="text-slate-300 text-sm">Product</label>
            <select
              id="staff-drink-product"
              value={productId}
              onChange={e => setProductId(e.target.value)}
              className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {products.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="staff-drink-quantity" className="text-slate-300 text-sm">Quantity</label>
            <input
              id="staff-drink-quantity"
              type="number"
              min="1"
              step="1"
              value={quantity}
              onChange={e => setQuantity(e.target.value)}
              className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
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
              {saving ? 'Saving…' : 'Log Drink'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
