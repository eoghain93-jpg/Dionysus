import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { Download, BarChart2, TrendingUp, Clock } from '../lib/icons'
import DailySummary from '../components/reports/DailySummary'
import BusiestHours from '../components/reports/BusiestHours'
import TopProducts from '../components/reports/TopProducts'

function todayISO() {
  return new Date().toISOString().split('T')[0]
}

export default function ReportsPage() {
  const [date, setDate] = useState(todayISO())
  const [exporting, setExporting] = useState(false)

  async function handleExportCSV() {
    setExporting(true)
    try {
      const { data: orders } = await supabase
        .from('orders')
        .select('id, created_at, total_amount, payment_method, status, members(name, membership_number)')
        .gte('created_at', `${date}T00:00:00`)
        .lte('created_at', `${date}T23:59:59`)
        .order('created_at')

      if (!orders || orders.length === 0) {
        alert('No orders found for the selected date.')
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
    <div className="flex flex-col h-full min-h-0 p-4 gap-6 overflow-auto">
      {/* Page header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1
          className="text-2xl font-bold text-white"
          style={{ fontFamily: "'Playfair Display SC', serif" }}
        >
          Reports
        </h1>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Date picker */}
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            max={todayISO()}
            aria-label="Select report date"
            className="bg-[#0F172A] border border-slate-700 rounded-xl px-3 min-h-[44px] text-white text-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
          />
          {/* Export CSV */}
          <button
            onClick={handleExportCSV}
            disabled={exporting}
            className="flex items-center gap-2 px-4 min-h-[44px] rounded-xl bg-[#1E293B] hover:bg-slate-700 border border-slate-600 text-white text-sm font-semibold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
          >
            <Download size={16} aria-hidden="true" />
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
        </div>
      </div>

      {/* Daily Summary */}
      <section aria-labelledby="daily-summary-heading">
        <div className="flex items-center gap-2 mb-3">
          <BarChart2 size={18} aria-hidden="true" className="text-[#22C55E]" />
          <h2
            id="daily-summary-heading"
            className="text-base font-semibold text-white"
            style={{ fontFamily: "'Playfair Display SC', serif" }}
          >
            Daily Summary
          </h2>
          <span className="text-slate-500 text-sm ml-1">{date}</span>
        </div>
        <DailySummary date={date} />
      </section>

      {/* Busiest Hours */}
      <section aria-labelledby="busiest-hours-heading">
        <div className="flex items-center gap-2 mb-3">
          <Clock size={18} aria-hidden="true" className="text-[#3B82F6]" />
          <h2
            id="busiest-hours-heading"
            className="text-base font-semibold text-white"
            style={{ fontFamily: "'Playfair Display SC', serif" }}
          >
            Busiest Hours
          </h2>
          <span className="text-slate-500 text-sm ml-1">Last 7 days</span>
        </div>
        <div className="bg-[#0F172A] border border-slate-700 rounded-2xl p-4">
          <BusiestHours />
        </div>
      </section>

      {/* Top Products */}
      <section aria-labelledby="top-products-heading">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp size={18} aria-hidden="true" className="text-[#3B82F6]" />
          <h2
            id="top-products-heading"
            className="text-base font-semibold text-white"
            style={{ fontFamily: "'Playfair Display SC', serif" }}
          >
            Top 10 Products
          </h2>
          <span className="text-slate-500 text-sm ml-1">Last 7 days by revenue</span>
        </div>
        <div className="bg-[#0F172A] border border-slate-700 rounded-2xl p-4">
          <TopProducts />
        </div>
      </section>
    </div>
  )
}
