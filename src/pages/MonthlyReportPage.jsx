import { useState } from 'react'
import { Download, Mail, RefreshCw, Calendar } from '../lib/icons'
import { fetchMonthlyReportData, toCsv, monthLabel } from '../lib/monthlyReport'
import { supabase } from '../lib/supabase'
import { useToastStore } from '../hooks/useToast'
import { logEvent } from '../lib/audit/log'

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
      logEvent('report.viewed', { report: 'monthly', month })
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
    logEvent('report.exported', {
      report: 'monthly', month: data.month, rows: Math.max(0, csv.split('\n').length - 1),
    }, { severity: 1 })
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
      logEvent('report.emailed', { report: 'monthly', month: data.month }, { severity: 1 })
    } catch (err) {
      useToastStore.getState().addToast(`Email failed: ${err.message}`, 'error')
      logEvent('report.email_failed', {
        report: 'monthly', month: data.month, message: String(err?.message ?? err).slice(0, 300),
      }, { severity: 1 })
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
    <div className="ui-page">
      <div className="ui-page-header justify-start">
        <Calendar size={24} className="text-slate-400" aria-hidden="true" />
        <h1 className="ui-title">Monthly Report</h1>
        {data && <span className="ui-subtitle">{monthLabel(data.month)}</span>}
      </div>

      {/* Controls */}
      <div className="ui-card p-4 flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-auto">
          <label htmlFor="mr-month" className="ui-label">Month</label>
          <input
            id="mr-month"
            type="month"
            value={month}
            onChange={e => setMonth(e.target.value)}
            max={currentMonthISO()}
            className="ui-input sm:w-56 font-bold [color-scheme:dark]"
          />
        </div>
        <button
          onClick={loadReport}
          disabled={loading}
          className="ui-btn ui-btn-primary flex-1 sm:flex-none"
        >
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
          {loading ? 'Loading…' : data ? 'Reload' : 'Load report'}
        </button>
        {data && (
          <>
            <button
              onClick={downloadCsv}
              className="ui-btn ui-btn-secondary flex-1 sm:flex-none"
            >
              <Download size={18} aria-hidden="true" />
              Download CSV
            </button>
            <button
              onClick={emailReport}
              disabled={emailing}
              className="ui-btn ui-btn-secondary flex-1 sm:flex-none"
            >
              <Mail size={18} aria-hidden="true" />
              {emailing ? 'Sending…' : 'Email to accountant'}
            </button>
          </>
        )}
      </div>

      {error && <p className="ui-banner ui-banner-bad">{error}</p>}

      {/* Month totals */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
          <SummaryCard label="Revenue" value={fmt(data.totals.revenue)} wide />
          <SummaryCard label="Cash" value={fmt(data.totals.cash)} />
          <SummaryCard label="Card" value={fmt(data.totals.card)} />
          <SummaryCard label="Refunds" value={fmt(data.totals.refunds)} accent="red" />
          <SummaryCard label="Net revenue" value={fmt(data.totals.netRevenue)} />
          <SummaryCard label="Transactions" value={String(data.totals.transactionCount)} />
          <SummaryCard label="Wastage" value={fmt(data.totals.wastage)} accent="red" />
          <SummaryCard label="Staff drinks" value={fmt(data.totals.staffDrinks)} accent="amber" />
          <SummaryCard label="Cashback out" value={fmt(data.totals.cashback)} />
          <SummaryCard label="Prize wins out" value={fmt(data.totals.prizeWins)} />
          <SummaryCard
            label={`Variance (${data.totals.closedDayCount} days)`}
            value={fmt(data.totals.variance)}
            accent={data.totals.variance < 0 ? 'red' : 'emerald'}
          />
          <SummaryCard label="Outstanding tabs" value={fmt(data.outstandingTabs)} accent="amber" />
        </div>
      )}

      {/* Daily table */}
      {data && (
        <div className="ui-card overflow-x-auto shrink-0">
          <table className="w-full min-w-[760px]">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="ui-th">Date</th>
                <th className="ui-th text-right">Cash</th>
                <th className="ui-th text-right">Card</th>
                <th className="ui-th text-right">Total</th>
                <th className="ui-th text-right">Refunds</th>
                <th className="ui-th text-right">Float</th>
                <th className="ui-th text-right">Actual cash</th>
                <th className="ui-th text-right">Variance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {activeDays.map(d => (
                <tr key={d.date}>
                  <td className="ui-td text-white font-semibold whitespace-nowrap">{d.date}</td>
                  <td className="ui-td text-right">{fmt(d.cash)}</td>
                  <td className="ui-td text-right">{fmt(d.card)}</td>
                  <td className="ui-td text-right text-white font-extrabold">{fmt(d.total)}</td>
                  <td className="ui-td text-right text-red-300">{d.refunds ? fmt(d.refunds) : '—'}</td>
                  <td className="ui-td text-right text-slate-300">{d.openingFloat === null ? '—' : fmt(d.openingFloat)}</td>
                  <td className="ui-td text-right text-slate-300">{d.actualCash === null ? '—' : fmt(d.actualCash)}</td>
                  <td className={`ui-td text-right font-bold ${d.variance === null ? 'text-slate-400' : d.variance < 0 ? 'text-red-300' : 'text-emerald-300'}`}>
                    {d.variance === null ? '—' : fmt(d.variance)}
                  </td>
                </tr>
              ))}
              {activeDays.length === 0 && (
                <tr><td colSpan={8} className="ui-empty">No trading activity this month</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Product sales */}
      {data && data.topProducts.length > 0 && (
        <div className="ui-card overflow-x-auto shrink-0">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="ui-th">Product</th>
                <th className="ui-th text-right">Qty</th>
                <th className="ui-th text-right">Revenue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {data.topProducts.map(p => (
                <tr key={p.name}>
                  <td className="ui-td text-white font-semibold">{p.name}</td>
                  <td className="ui-td text-right">{p.qty}</td>
                  <td className="ui-td text-right font-bold">{fmt(p.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && (
        <p className="ui-help max-w-4xl">
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
    emerald: 'text-emerald-300',
    red: 'text-red-300',
    amber: 'text-amber-300',
  }[accent] ?? 'text-white'
  return (
    <div className={`ui-stat ${wide ? 'col-span-2 sm:col-span-1' : ''}`}>
      <p className="ui-stat-label">{label}</p>
      <p className={`ui-stat-value text-[26px] mt-1 ${colour}`} data-testid={`mr-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`}>{value}</p>
    </div>
  )
}
