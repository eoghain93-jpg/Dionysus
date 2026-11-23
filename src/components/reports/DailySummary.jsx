import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { tradingDayRange } from '../../lib/tradingDay'
import { CreditCard, Banknote } from '../../lib/icons'
import { logEvent } from '../../lib/audit/log'

export default function DailySummary({ date }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [summary, setSummary] = useState(null)

  useEffect(() => {
    if (!date) return
    setLoading(true)
    setError(null)

    const range = tradingDayRange(date)
    supabase
      .from('orders')
      .select('id, total_amount, payment_method, status')
      .gte('created_at', range.from)
      .lt('created_at', range.to)
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
        logEvent('report.viewed', { report: 'daily', date })
      })
      .finally(() => setLoading(false))
  }, [date])

  if (loading) {
    return (
      <p className="ui-empty">Loading daily summary…</p>
    )
  }

  if (error) {
    return (
      <p className="ui-banner ui-banner-bad">Error: {error}</p>
    )
  }

  if (!summary) return null

  const fmt = n => `£${n.toFixed(2)}`

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {/* Total Revenue */}
      <div className="ui-stat col-span-2 sm:col-span-3 lg:col-span-2 flex flex-col gap-1">
        <span className="ui-stat-label">Total Revenue</span>
        <span
          className="ui-stat-value text-[44px]"
          data-testid="total-revenue"
        >
          {fmt(summary.totalRevenue)}
        </span>
      </div>

      {/* Transaction Count */}
      <div className="ui-stat flex flex-col gap-1">
        <span className="ui-stat-label">Transactions</span>
        <span
          className="ui-stat-value"
          data-testid="transaction-count"
        >
          {summary.transactionCount}
        </span>
      </div>

      {/* Void Count */}
      <div className="ui-stat flex flex-col gap-1">
        <span className="ui-stat-label">Voids</span>
        <span
          className="ui-stat-value"
          data-testid="void-count"
        >
          {summary.voidCount}
        </span>
      </div>

      {/* Payment breakdown */}
      <div className="ui-stat col-span-2 sm:col-span-3 lg:col-span-2 flex flex-col gap-2">
        <span className="ui-stat-label">Payment Breakdown</span>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-slate-300 text-base font-semibold">
              <Banknote size={18} aria-hidden="true" className="text-emerald-300" />
              Cash
            </span>
            <span className="text-white text-xl font-extrabold" data-testid="cash-total">
              {fmt(summary.cashTotal)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-slate-300 text-base font-semibold">
              <CreditCard size={18} aria-hidden="true" className="text-blue-400" />
              Card
            </span>
            <span className="text-white text-xl font-extrabold" data-testid="card-total">
              {fmt(summary.cardTotal)}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
