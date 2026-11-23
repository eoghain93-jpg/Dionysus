import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { tradingDayRange, tradingTodayISO } from '../lib/tradingDay'
import { useToastStore } from '../hooks/useToast'
import { Download, BarChart2, TrendingUp, Clock, FileText, Package, Calendar } from '../lib/icons'
import { Link } from 'react-router-dom'
import DailySummary from '../components/reports/DailySummary'
import BusiestHours from '../components/reports/BusiestHours'
import TopProducts from '../components/reports/TopProducts'
import ZReportModal from '../components/reports/ZReportModal'
import PinGate from '../components/till/PinGate'

// Trading day, not calendar day: at 1am on a match night this is still
// "yesterday", so the Z report defaults to the session being closed.
function todayISO() {
  return tradingTodayISO()
}

export default function ReportsPage() {
  const [date, setDate] = useState(todayISO())
  const [exporting, setExporting] = useState(false)
  const [showPinGate, setShowPinGate] = useState(false)
  const [showZReport, setShowZReport] = useState(false)

  async function handleExportCSV() {
    setExporting(true)
    try {
      const range = tradingDayRange(date)
      const { data: orders } = await supabase
        .from('orders')
        .select('id, created_at, total_amount, payment_method, status, members(name, membership_number)')
        .gte('created_at', range.from)
        .lt('created_at', range.to)
        .order('created_at')

      if (!orders || orders.length === 0) {
        useToastStore.getState().addToast('No orders found for the selected date.', 'info')
        return
      }

      const headers = 'Order ID,Time,Member,Membership No,Payment Method,Total,Status'
      const rows = orders.map(o => [
        o.id,
        new Date(o.created_at).toLocaleTimeString(),
        o.members?.name ?? 'Walk-in',
        o.members?.membership_number ?? '',
        o.payment_method,
        o.total_amount,
        o.status,
      ].join(','))
      const csv = [headers, ...rows].join('\n')

      const blob = new Blob([csv], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `orders-${date}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="ui-page gap-6">
      {/* Page header */}
      <div className="ui-page-header">
        <h1 className="ui-title">
          Reports
        </h1>
        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Date picker */}
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            max={todayISO()}
            aria-label="Select report date"
            className="ui-input w-auto font-bold cursor-pointer [color-scheme:dark]"
          />
          {/* Export CSV */}
          <button
            onClick={handleExportCSV}
            disabled={exporting}
            className="ui-btn ui-btn-secondary"
          >
            <Download size={18} aria-hidden="true" />
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
          {/* Stocktake — opens dedicated page with date range, table, CSV download, email */}
          <Link to="/stocktake" className="ui-btn ui-btn-secondary">
            <Package size={18} aria-hidden="true" />
            Stocktake
          </Link>
          {/* Monthly report — month picker, daily takings, totals, CSV + email for the accountant */}
          <Link to="/monthly-report" className="ui-btn ui-btn-secondary">
            <Calendar size={18} aria-hidden="true" />
            Monthly
          </Link>
          {/* Z Report */}
          <button
            onClick={() => setShowPinGate(true)}
            className="ui-btn ui-btn-primary"
          >
            <FileText size={18} aria-hidden="true" />
            Z Report
          </button>
        </div>
      </div>

      {/* Daily Summary */}
      <section aria-labelledby="daily-summary-heading">
        <div className="flex items-baseline gap-2.5 flex-wrap mb-3">
          <BarChart2 size={18} aria-hidden="true" className="text-slate-400 self-center" />
          <h2 id="daily-summary-heading" className="ui-section-title">
            Daily Summary
          </h2>
          <span className="ui-subtitle">{date}</span>
        </div>
        <DailySummary date={date} />
      </section>

      {/* Busiest Hours */}
      <section aria-labelledby="busiest-hours-heading">
        <div className="flex items-baseline gap-2.5 flex-wrap mb-3">
          <Clock size={18} aria-hidden="true" className="text-slate-400 self-center" />
          <h2 id="busiest-hours-heading" className="ui-section-title">
            Busiest Hours
          </h2>
          <span className="ui-subtitle">Last 7 days</span>
        </div>
        <div className="ui-card p-4">
          <BusiestHours />
        </div>
      </section>

      {/* Top Products */}
      <section aria-labelledby="top-products-heading">
        <div className="flex items-baseline gap-2.5 flex-wrap mb-3">
          <TrendingUp size={18} aria-hidden="true" className="text-slate-400 self-center" />
          <h2 id="top-products-heading" className="ui-section-title">
            Top 10 Products
          </h2>
          <span className="ui-subtitle">Last 7 days by revenue</span>
        </div>
        <div className="ui-card">
          <TopProducts />
        </div>
      </section>
      {showPinGate && (
        <PinGate
          onConfirm={() => { setShowPinGate(false); setShowZReport(true) }}
          onCancel={() => setShowPinGate(false)}
        />
      )}

      {showZReport && (
        <ZReportModal
          date={date}
          onClose={() => setShowZReport(false)}
          onDayClose={() => setShowZReport(false)}
        />
      )}
    </div>
  )
}
