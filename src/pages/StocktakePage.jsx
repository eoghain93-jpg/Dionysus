import { useState } from 'react'
import { Download, Mail, RefreshCw, Package } from '../lib/icons'
import { fetchStocktakeData, toCsv } from '../lib/stocktake'
import { supabase } from '../lib/supabase'
import { tradingTodayISO, addDaysISO } from '../lib/tradingDay'
import { useToastStore } from '../hooks/useToast'
import { logEvent } from '../lib/audit/log'

// Trading day, matching the Reports page: before 6am "today" is still
// last night's session.
function todayISO() {
  return tradingTodayISO()
}

function daysAgoISO(n) {
  return addDaysISO(todayISO(), -n)
}

function fmt(n) {
  return `£${Number(n).toFixed(2)}`
}

export default function StocktakePage() {
  const [startDate, setStartDate] = useState(daysAgoISO(30))
  const [endDate, setEndDate] = useState(todayISO())
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState(null)
  const [emailing, setEmailing] = useState(false)
  const [error, setError] = useState(null)

  async function loadReport() {
    setLoading(true)
    setError(null)
    try {
      const d = await fetchStocktakeData(startDate, endDate)
      setData(d)
      logEvent('report.viewed', { report: 'stocktake', from: startDate, to: endDate })
    } catch (err) {
      setError(err.message ?? 'Failed to load stocktake')
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
    a.download = `stocktake-${data.startDate}-to-${data.endDate}.csv`
    a.click()
    URL.revokeObjectURL(url)
    logEvent('report.exported', {
      report: 'stocktake', from: data.startDate, to: data.endDate, rows: Math.max(0, csv.split('\n').length - 1),
    }, { severity: 1 })
  }

  async function emailReport() {
    if (!data) return
    setEmailing(true)
    try {
      const csv = toCsv(data)
      const { error: err } = await supabase.functions.invoke('send-stocktake', {
        body: { csv, startDate: data.startDate, endDate: data.endDate },
      })
      if (err) throw err
      useToastStore.getState().addToast('Stocktake report emailed', 'success')
      logEvent('report.emailed', { report: 'stocktake', from: data.startDate, to: data.endDate }, { severity: 1 })
    } catch (err) {
      useToastStore.getState().addToast(`Email failed: ${err.message}`, 'error')
      logEvent('report.email_failed', {
        report: 'stocktake', from: data.startDate, to: data.endDate, message: String(err?.message ?? err).slice(0, 300),
      }, { severity: 1 })
    } finally {
      setEmailing(false)
    }
  }

  return (
    <div className="ui-page">
      <div className="ui-page-header">
        <h1 className="ui-title flex items-center gap-3">
          <Package size={28} className="text-slate-400 shrink-0" aria-hidden="true" />
          Stocktake Report
        </h1>
      </div>

      {/* Controls */}
      <div className="ui-card p-4 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[150px] sm:flex-none">
          <label htmlFor="stk-start" className="ui-label">From</label>
          <input
            id="stk-start"
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            max={endDate}
            className="ui-input [color-scheme:dark]"
          />
        </div>
        <div className="flex-1 min-w-[150px] sm:flex-none">
          <label htmlFor="stk-end" className="ui-label">To</label>
          <input
            id="stk-end"
            type="date"
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
            min={startDate}
            max={todayISO()}
            className="ui-input [color-scheme:dark]"
          />
        </div>
        <button
          onClick={loadReport}
          disabled={loading}
          className="ui-btn ui-btn-primary w-full sm:w-auto"
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
              {emailing ? 'Sending…' : 'Email to manager'}
            </button>
          </>
        )}
      </div>

      {error && <p className="ui-banner ui-banner-bad">{error}</p>}

      {/* Summary */}
      {data && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <SummaryCard label="Sales (retail)" value={fmt(data.totals.salesRevenue)} accent="emerald" />
          <SummaryCard label="Wastage (retail)" value={fmt(data.totals.wastageValue)} accent="red" />
          <SummaryCard label="Staff drinks (retail)" value={fmt(data.totals.staffDrinkValue)} accent="amber" />
        </div>
      )}

      {/* Table */}
      {data && (
        <div className="ui-card flex-1 min-h-[320px] overflow-auto">
          <table className="w-full min-w-[760px] border-collapse">
            <thead className="bg-slate-900 sticky top-0 z-10 shadow-[0_1px_0_0_var(--color-slate-800)]">
              <tr>
                <th className="ui-th">Product</th>
                <th className="ui-th text-right">Sold</th>
                <th className="ui-th text-right">Sold £</th>
                <th className="ui-th text-right">Wasted</th>
                <th className="ui-th text-right">Staff</th>
                <th className="ui-th text-right">Total out</th>
                <th className="ui-th text-right">System stock</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {data.rows.map(r => (
                <tr key={r.product_id}>
                  <td className="ui-td">
                    <div className="text-white text-base font-bold">{r.name}</div>
                    <div className="text-slate-400 text-sm capitalize">{r.category} · {r.unit}</div>
                  </td>
                  <td className="ui-td text-right tabular-nums">{r.soldQty || '—'}</td>
                  <td className="ui-td text-right tabular-nums">{r.soldRevenue ? fmt(r.soldRevenue) : '—'}</td>
                  <td className="ui-td text-right tabular-nums text-red-300">{r.wastageQty || '—'}</td>
                  <td className="ui-td text-right tabular-nums text-amber-300">{r.staffDrinkQty || '—'}</td>
                  <td className="ui-td text-right tabular-nums text-white font-extrabold">{r.totalOut || '—'}</td>
                  <td className="ui-td text-right tabular-nums text-slate-400">{r.systemStock}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Caveat */}
      {data && (
        <p className="ui-help max-w-3xl">
          Note: <strong className="text-slate-200">System stock now</strong> reflects only manual wastage / staff-drink /
          spillage adjustments — sales don't auto-decrement stock yet. For the stocktaker, the Sold / Wasted / Staff columns
          are the trustworthy activity figures.
        </p>
      )}
    </div>
  )
}

function SummaryCard({ label, value, accent }) {
  const ring = {
    emerald: 'text-emerald-300',
    red: 'text-red-300',
    amber: 'text-amber-300',
  }[accent] ?? 'text-white'
  return (
    <div className="ui-stat">
      <p className="ui-stat-label">{label}</p>
      <p className={`ui-stat-value ${ring}`}>{value}</p>
    </div>
  )
}
