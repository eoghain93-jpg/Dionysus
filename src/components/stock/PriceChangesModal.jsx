import { useState, useEffect } from 'react'
import { X } from '../../lib/icons'
import { fetchPriceChanges } from '../../lib/priceChanges'

const money = v => `£${Number(v).toFixed(2)}`

function when(ts) {
  return new Date(ts).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function PriceLine({ label, from, to }) {
  const changed = Number(from) !== Number(to)
  return (
    <p className={`text-sm tabular-nums ${changed ? 'text-white' : 'text-slate-500'}`}>
      <span className="inline-block w-20 text-slate-400">{label}</span>
      {changed ? <>{money(from)} → <span className="font-semibold">{money(to)}</span></> : <>{money(to)} (unchanged)</>}
    </p>
  )
}

/**
 * PriceChangesModal — who changed which price, from what to what, and when.
 * Read-only view of the product_price_changes log.
 */
export default function PriceChangesModal({ onClose }) {
  const [changes, setChanges] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchPriceChanges()
      .then(setChanges)
      .catch(err => setError(err.message ?? 'Could not load price changes'))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Price changes"
    >
      <div className="bg-[#0F172A] border border-slate-700 rounded-2xl w-full max-w-md p-5 flex flex-col gap-4 max-h-[85dvh]">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-white font-bold text-lg">Price Changes</h2>
            <p className="text-slate-400 text-xs">Every change to a standard or member price, newest first.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-white cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center">
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        {loading && <p className="text-slate-400 text-sm text-center py-6">Loading price changes…</p>}
        {error && <p role="alert" className="text-red-400 text-sm text-center">{error}</p>}
        {!loading && !error && changes.length === 0 && (
          <p className="text-slate-500 text-sm text-center py-6">No price changes recorded yet</p>
        )}

        <ul className="overflow-auto flex flex-col gap-2">
          {changes.map(c => (
            <li key={c.id} className="bg-slate-800 rounded-xl px-3 py-2 flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-white font-semibold truncate">{c.product?.name ?? 'Deleted product'}</span>
                <span className="text-slate-400 text-xs whitespace-nowrap">{when(c.changed_at)}</span>
              </div>
              <PriceLine label="Standard" from={c.old_standard_price} to={c.new_standard_price} />
              <PriceLine label="Member" from={c.old_member_price} to={c.new_member_price} />
              <p className="text-slate-400 text-xs">
                {c.staff?.name ?? 'Not made from the Stock page'}
                {c.till_id ? ` · ${c.till_id}` : ''}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
