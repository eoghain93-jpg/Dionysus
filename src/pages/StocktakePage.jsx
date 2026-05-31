import { useState } from 'react'
import { Download, Mail, RefreshCw, Package } from '../lib/icons'
import { fetchStocktakeData, toCsv } from '../lib/stocktake'
import { supabase } from '../lib/supabase'
import { useToastStore } from '../hooks/useToast'

function todayISO() {
  return new Date().toISOString().split('T')[0]
}

function daysAgoISO(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().split('T')[0]
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
    } catch (err) {
      useToastStore.getState().addToast(`Email failed: ${err.message}`, 'error')
    } finally {
      setEmailing(false)
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0 p-4 gap-4 overflow-auto">
      <div className="flex items-center gap-3">
        <Package size={20} className="text-blue-400" aria-hidden="true" />
        <h1 className="text-2xl font-bold text-white">Stocktake Report</h1>
      </div>

      {/* Controls */}
      <div className="bg-[#0F172A] rounded-2xl border border-slate-700 p-4 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="stk-start" className="block text-slate-400 text-xs mb-1">From</label>
          <input
            id="stk-start"
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            max={endDate}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label htmlFor="stk-end" className="block text-slate-400 text-xs mb-1">To</label>
          <input
            id="stk-end"
            type="date"
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
            min={startDate}
            max={todayISO()}
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
              {emailing ? 'Sending…' : 'Email to manager'}
            </button>
          </>
        )}
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {/* Summary */}
      {data && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <SummaryCard label="Sales (retail)" value={fmt(data.totals.salesRevenue)} accent="emerald" />
          <SummaryCard label="Wastage (retail)" value={fmt(data.totals.wastageValue)} accent="red" />
          <SummaryCard label="Staff drinks (retail)" value={fmt(data.totals.staffDrinkValue)} accent="orange" />
        </div>
      )}

      {/* Table */}
      {data && (
        <div className="flex-1 bg-[#0F172A] rounded-2xl border border-slate-700 overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-800 sticky top-0">
              <tr className="text-slate-400 text-xs uppercase tracking-wide">
                <th className="text-left px-3 py-2">Product</th>
                <th className="text-right px-3 py-2">Sold</th>
                <th className="text-right px-3 py-2">Sold £</th>
                <th className="text-right px-3 py-2">Wasted</th>
                <th className="text-right px-3 py-2">Staff</th>
                <th className="text-right px-3 py-2">Total out</th>
                <th className="text-right px-3 py-2">System stock</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {data.rows.map(r => (
                <tr key={r.product_id} className="text-slate-200">
                  <td className="px-3 py-2">
                    <div className="text-white">{r.name}</div>
                    <div className="text-slate-500 text-xs">{r.category} · {r.unit}</div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.soldQty || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.soldRevenue ? fmt(r.soldRevenue) : '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-red-400/80">{r.wastageQty || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-orange-400/80">{r.staffDrinkQty || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-white font-medium">{r.totalOut || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-400">{r.systemStock}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Caveat */}
      {data && (
        <p className="text-slate-500 text-xs">
          Note: <strong className="text-slate-400">System stock now</strong> reflects only manual wastage / staff-drink /
          spillage adjustments — sales don't auto-decrement stock yet. For the stocktaker, the Sold / Wasted / Staff columns
          are the trustworthy activity figures.
        </p>
      )}
    </div>
  )
}

function SummaryCard({ label, value, accent }) {
  const ring = {
    emerald: 'text-emerald-400',
    red: 'text-red-400',
    orange: 'text-orange-400',
  }[accent] ?? 'text-white'
  return (
    <div className="bg-[#0F172A] border border-slate-700 rounded-2xl p-4">
      <p className="text-slate-400 text-xs uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${ring}`}>{value}</p>
    </div>
  )
}
