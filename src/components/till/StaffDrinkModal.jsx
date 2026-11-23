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
      className="ui-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Staff Drink"
    >
      <div className="ui-modal max-w-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="ui-modal-title">Staff Drink</h2>
            <p className="ui-subtitle">{activeStaff?.name}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="ui-btn ui-btn-ghost ui-btn-icon shrink-0">
            <X size={22} aria-hidden="true" />
          </button>
        </div>

        <div>
          <label htmlFor="staff-drink-who" className="ui-label">Whose drink?</label>
          <select
            id="staff-drink-who"
            value={staffId}
            onChange={e => setStaffId(e.target.value)}
            className="ui-select w-full font-semibold"
          >
            {staff.map(s => (
              <option key={s.id} value={s.id}>{s.name}{s.id === activeStaff?.id ? ' (you)' : ''}</option>
            ))}
          </select>
        </div>

        {credits.length > 0 && (
          <div className="bg-blue-950 border border-blue-900 rounded-2xl p-4 flex flex-col gap-2.5">
            <p className="text-white text-[17px] font-extrabold leading-tight">
              {selectedStaff?.id === activeStaff?.id
                ? `${credits.length} banked drink${credits.length === 1 ? '' : 's'} waiting`
                : `${selectedStaff?.name} has ${credits.length} banked drink${credits.length === 1 ? '' : 's'}`}
            </p>
            <p className="text-blue-300 text-[15px]">
              Bought by customers — pick the drink being poured below, then redeem.
            </p>
            <button
              type="button"
              onClick={handleRedeem}
              disabled={saving}
              className="ui-btn ui-btn-accent"
            >
              Redeem 1 Banked Drink
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label htmlFor="staff-drink-product" className="ui-label">Product</label>
            <select
              id="staff-drink-product"
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
          <div>
            <label htmlFor="staff-drink-quantity" className="ui-label">Quantity</label>
            <input
              id="staff-drink-quantity"
              type="number"
              min="1"
              step="1"
              value={quantity}
              onChange={e => setQuantity(e.target.value)}
              className="ui-input min-h-[56px] text-xl font-bold"
            />
          </div>
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
              {saving ? 'Saving…' : 'Log Drink'}
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
