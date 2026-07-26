import { useState } from 'react'
import { Download, Mail, RefreshCw, Calendar } from '../lib/icons'
import { fetchMonthlyReportData, toCsv, monthLabel } from '../lib/monthlyReport'
import { supabase } from '../lib/supabase'
import { useToastStore } from '../hooks/useToast'

// Default to the previous calendar month — the accountant's report is
// almost always for the month just gone.
function previousMonthISO() {
  const d = new Date()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() - 1)
  return d.toISOString().slice(0, 7)
}

function currentMonthISO() {
  return new Date().toISOString().slice(0, 7)
}

const fmt = n => `£${Number(n ?? 0).toFixed(2)}`

export default function MonthlyReportPage() {
  const [month, setMonth] = useState(previousMonthISO())
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState(null)
  const [emailing, setEmailing] = useState(false)
  const [error, setError] = useState(null)

  async function loadReport() {
    setLoading(true)
    setError(null)
    try {
      setData(await fetchMonthlyReportData(month))
    } catch (err) {
      setError(err.message ?? 'Failed to load monthly report')
    } finally {
      setLoading(false)
    }
  }

  function downloadCsv() {
    if (!data) return
    const csv = toCsv(data)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `monthly-report-${data.month}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function emailReport() {
    if (!data) return
    setEmailing(true)
    try {
      const csv = toCsv(data)
      const { error: err } = await supabase.functions.invoke('send-monthly-report', {
        body: { csv, month: data.month },
      })
      if (err) throw err
      useToastStore.getState().addToast('Monthly report emailed', 'success')
    } catch (err) {
      useToastStore.getState().addToast(`Email failed: ${err.message}`, 'error')
    } finally {
      setEmailing(false)
    }
  }

  // Only render days with any activity or a closed Z report — the accountant
  // doesn't need 10 zero rows for days the club was shut.
  const activeDays = data
    ? data.daily.filter(d => d.total > 0 || d.refunds > 0 || d.openingFloat !== null)
    : []

  return (
    <div className="flex flex-col h-full min-h-0 p-4 gap-4 overflow-auto">
      <div className="flex items-center gap-3">
        <Calendar size={20} className="text-emerald-400" aria-hidden="true" />
        <h1 className="text-2xl font-bold text-white">Monthly Report</h1>
        {data && <span className="text-slate-500 text-sm">{monthLabel(data.month)}</span>}
      </div>

      {/* Controls */}
      <div className="bg-[#0F172A] rounded-2xl border border-slate-700 p-4 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="mr-month" className="block text-slate-400 text-xs mb-1">Month</label>
          <input
            id="mr-month"
            type="month"
            value={month}
            onChange={e => setMonth(e.target.value)}
            max={currentMonthISO()}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          onClick={loadReport}
          disabled={loading}
          className="flex items-center gap-2 px-4 min-h-[40px] rounded-xl bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white text-sm font-semibold transition-colors cursor-pointer"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
          {loading ? 'Loading…' : data ? 'Reload' : 'Load report'}
        </button>
        {data && (
          <>
            <button
              onClick={downloadCsv}
              className="flex items-center gap-2 px-4 min-h-[40px] rounded-xl bg-slate-700 hover:bg-slate-600 border border-slate-600 text-white text-sm font-semibold transition-colors cursor-pointer"
            >
              <Download size={14} aria-hidden="true" />
              Download CSV
            </button>
            <button
              onClick={emailReport}
              disabled={emailing}
              className="flex items-center gap-2 px-4 min-h-[40px] rounded-xl bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm font-semibold transition-colors cursor-pointer"
            >
              <Mail size={14} aria-hidden="true" />
              {emailing ? 'Sending…' : 'Email to accountant'}
            </button>
          </>
        )}
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {/* Month totals */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <SummaryCard label="Revenue" value={fmt(data.totals.revenue)} accent="emerald" wide />
          <SummaryCard label="Cash" value={fmt(data.totals.cash)} />
          <SummaryCard label="Card" value={fmt(data.totals.card)} />
          <SummaryCard label="Refunds" value={fmt(data.totals.refunds)} accent="red" />
          <SummaryCard label="Net revenue" value={fmt(data.totals.netRevenue)} accent="emerald" />
          <SummaryCard label="Transactions" value={String(data.totals.transactionCount)} />
          <SummaryCard label="Wastage" value={fmt(data.totals.wastage)} accent="red" />
          <SummaryCard label="Staff drinks" value={fmt(data.totals.staffDrinks)} accent="orange" />
          <SummaryCard label="Cashback out" value={fmt(data.totals.cashback)} />
          <SummaryCard label="Prize wins out" value={fmt(data.totals.prizeWins)} />
          <SummaryCard
            label={`Variance (${data.totals.closedDayCount} days)`}
            value={fmt(data.totals.variance)}
            accent={data.totals.variance < 0 ? 'red' : 'emerald'}
          />
          <SummaryCard label="Outstanding tabs" value={fmt(data.outstandingTabs)} accent="orange" />
        </div>
      )}

      {/* Daily table */}
      {data && (
        <div className="bg-[#0F172A] rounded-2xl border border-slate-700 overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-800 sticky top-0">
              <tr className="text-slate-400 text-xs uppercase tracking-wide">
                <th className="text-left px-3 py-2">Date</th>
                <th className="text-right px-3 py-2">Cash</th>
                <th className="text-right px-3 py-2">Card</th>
                <th className="text-right px-3 py-2">Total</th>
                <th className="text-right px-3 py-2">Refunds</th>
                <th className="text-right px-3 py-2">Float</th>
                <th className="text-right px-3 py-2">Actual cash</th>
                <th className="text-right px-3 py-2">Variance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {activeDays.map(d => (
                <tr key={d.date} className="text-slate-200">
                  <td className="px-3 py-2 text-white">{d.date}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(d.cash)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(d.card)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-white font-medium">{fmt(d.total)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-red-400/80">{d.refunds ? fmt(d.refunds) : '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-400">{d.openingFloat === null ? '—' : fmt(d.openingFloat)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-400">{d.actualCash === null ? '—' : fmt(d.actualCash)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums font-medium ${d.variance === null ? 'text-slate-500' : d.variance < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                    {d.variance === null ? '—' : fmt(d.variance)}
                  </td>
                </tr>
              ))}
              {activeDays.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-500">No trading activity this month</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Product sales */}
      {data && data.topProducts.length > 0 && (
        <div className="bg-[#0F172A] rounded-2xl border border-slate-700 overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-800 sticky top-0">
              <tr className="text-slate-400 text-xs uppercase tracking-wide">
                <th className="text-left px-3 py-2">Product</th>
                <th className="text-right px-3 py-2">Qty</th>
                <th className="text-right px-3 py-2">Revenue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {data.topProducts.map(p => (
                <tr key={p.name} className="text-slate-200">
                  <td className="px-3 py-2 text-white">{p.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{p.qty}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(p.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && (
        <p className="text-slate-500 text-xs">
          Cash-basis figures, consistent with the daily Z reports: tab orders are excluded from revenue;
          tab settlements count as cash/card on the day they're paid. A day runs to 6am, so late sessions
          count toward the night they started. Outstanding tabs is a snapshot as of report generation —
          balance history isn't tracked per-day.
        </p>
      )}
    </div>
  )
}

function SummaryCard({ label, value, accent, wide }) {
  const colour = {
    emerald: 'text-emerald-400',
    red: 'text-red-400',
    orange: 'text-orange-400',
  }[accent] ?? 'text-white'
  return (
    <div className={`bg-[#0F172A] border border-slate-700 rounded-2xl p-4 ${wide ? 'col-span-2 sm:col-span-1' : ''}`}>
      <p className="text-slate-400 text-xs uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 tabular-nums ${colour}`} data-testid={`mr-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`}>{value}</p>
    </div>
  )
}
