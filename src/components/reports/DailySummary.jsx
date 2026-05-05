import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { CreditCard, Banknote } from '../../lib/icons'

export default function DailySummary({ date }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [summary, setSummary] = useState(null)

  useEffect(() => {
    if (!date) return
    setLoading(true)
    setError(null)

    supabase
      .from('orders')
      .select('id, total_amount, payment_method, status')
      .gte('created_at', `${date}T00:00:00`)
      .lte('created_at', `${date}T23:59:59`)
      .then(({ data, error: err }) => {
        if (err) {
          setError(err.message)
          return
        }
        const orders = data ?? []
        const paid   = orders.filter(o => o.status === 'paid')
        const voided = orders.filter(o => o.status === 'voided')
        // Cash-basis revenue: cash + card actually received. Tab orders are
        // IOUs and excluded — outstanding tab balances are tracked separately.
        const sumBy = (arr, m) => arr.filter(o => o.payment_method === m).reduce((s, o) => s + (o.total_amount ?? 0), 0)
        const cashTotal = sumBy(paid, 'cash')
        const cardTotal = sumBy(paid, 'card')
        const totalRevenue = cashTotal + cardTotal

        setSummary({
          totalRevenue,
          transactionCount: paid.filter(o => o.payment_method !== 'tab').length,
          voidCount: voided.length,
          cashTotal,
          cardTotal,
        })
      })
      .finally(() => setLoading(false))
  }, [date])

  if (loading) {
    return (
      <p className="text-slate-400 text-sm text-center py-8">Loading daily summary…</p>
    )
  }

  if (error) {
    return (
      <p className="text-red-400 text-sm text-center py-8">Error: {error}</p>
    )
  }

  if (!summary) return null

  const fmt = n => `£${n.toFixed(2)}`

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {/* Total Revenue */}
      <div className="col-span-2 sm:col-span-3 lg:col-span-2 bg-[#0F172A] border border-slate-700 rounded-2xl p-4 flex flex-col gap-1">
        <span className="text-slate-400 text-xs uppercase tracking-wide">Total Revenue</span>
        <span
          className="text-3xl font-bold text-[#22C55E]"
          data-testid="total-revenue"
        >
          {fmt(summary.totalRevenue)}
        </span>
      </div>

      {/* Transaction Count */}
      <div className="bg-[#0F172A] border border-slate-700 rounded-2xl p-4 flex flex-col gap-1">
        <span className="text-slate-400 text-xs uppercase tracking-wide">Transactions</span>
        <span
          className="text-2xl font-bold text-white"
          data-testid="transaction-count"
        >
          {summary.transactionCount}
        </span>
      </div>

      {/* Void Count */}
      <div className="bg-[#0F172A] border border-slate-700 rounded-2xl p-4 flex flex-col gap-1">
        <span className="text-slate-400 text-xs uppercase tracking-wide">Voids</span>
        <span
          className="text-2xl font-bold text-white"
          data-testid="void-count"
        >
          {summary.voidCount}
        </span>
      </div>

      {/* Payment breakdown */}
      <div className="col-span-2 sm:col-span-3 lg:col-span-2 bg-[#0F172A] border border-slate-700 rounded-2xl p-4 flex flex-col gap-2">
        <span className="text-slate-400 text-xs uppercase tracking-wide">Payment Breakdown</span>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-slate-300 text-sm">
              <Banknote size={14} aria-hidden="true" className="text-[#22C55E]" />
              Cash
            </span>
            <span className="text-white text-sm font-semibold" data-testid="cash-total">
              {fmt(summary.cashTotal)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-slate-300 text-sm">
              <CreditCard size={14} aria-hidden="true" className="text-[#3B82F6]" />
              Card
            </span>
            <span className="text-white text-sm font-semibold" data-testid="card-total">
              {fmt(summary.cardTotal)}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
