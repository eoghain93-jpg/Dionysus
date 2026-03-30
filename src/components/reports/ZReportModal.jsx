import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { fetchZReportData } from '../../lib/zReport'
import { useSessionStore } from '../../stores/sessionStore'
import { X, Download, Lock, CreditCard, Banknote, Receipt } from '../../lib/icons'

function fmt(n) {
  if (n === undefined || n === null) return '£0.00'
  const abs = Math.abs(n).toFixed(2)
  return n < 0 ? `-£${abs}` : `£${abs}`
}

export default function ZReportModal({ date, onClose, onDayClose }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [data, setData] = useState(null)
  const [openingFloat, setOpeningFloat] = useState(0)
  const [actualCash, setActualCash] = useState(0)
  const [closing, setClosing] = useState(false)
  const [closeError, setCloseError] = useState(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetchZReportData(date)
      .then(setData)
      .catch(err => setError(err.message ?? 'Failed to load report'))
      .finally(() => setLoading(false))
  }, [date])

  const cashSales = data?.salesSummary?.cashTotal ?? 0
  const expectedInTill = openingFloat + cashSales
  const variance = actualCash - expectedInTill

  async function handleExportCSV() {
    if (!data) return
    const { salesSummary: s, topProducts } = data
    const lines = [
      `Z Report,${date}`,
      '',
      'Sales Summary',
      `Total Revenue,${s.totalRevenue.toFixed(2)}`,
      `Transactions,${s.transactionCount}`,
      `Cash,${s.cashTotal.toFixed(2)}`,
      `Card,${s.cardTotal.toFixed(2)}`,
      `Tab,${s.tabTotal.toFixed(2)}`,
      `Refunds,-${s.refundsTotal.toFixed(2)}`,
      `Net Revenue,${s.netRevenue.toFixed(2)}`,
      '',
      'Top Products',
      'Name,Qty,Revenue',
      ...topProducts.map(p => `${p.name},${p.qty},${p.revenue.toFixed(2)}`),
      '',
      'Cash Reconciliation',
      `Opening Float,${openingFloat.toFixed(2)}`,
      `Cash Sales,${cashSales.toFixed(2)}`,
      `Expected in Till,${expectedInTill.toFixed(2)}`,
      `Actual Cash,${actualCash.toFixed(2)}`,
      `Variance,${variance.toFixed(2)}`,
    ]
    const csv = lines.join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `z-report-${date}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleCloseDay() {
    if (!data) return
    setClosing(true)
    setCloseError(null)
    try {
      const { salesSummary: s, topProducts } = data
      const reconciliation = {
        openingFloat,
        cashSales,
        expectedInTill,
        actualCash,
        variance,
      }

      // 1. Insert z_reports row
      const { error: dbErr } = await supabase
        .from('z_reports')
        .insert({
          report_date: date,
          opening_float: openingFloat,
          actual_cash: actualCash,
          closed_at: new Date().toISOString(),
        })

      if (dbErr) throw new Error(dbErr.message)

      // 2. Email report
      const { error: emailErr } = await supabase.functions.invoke('send-z-report', {
        body: {
          reportDate: date,
          salesSummary: s,
          topProducts,
          cashReconciliation: reconciliation,
        },
      })

      if (emailErr) throw new Error(emailErr.message)

      // 3. Lock the till
      useSessionStore.getState().clearSession()

      onDayClose()
    } catch (err) {
      setCloseError(err.message ?? 'Failed to close day')
    } finally {
      setClosing(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/80 flex items-start justify-center z-50 p-4 overflow-auto"
      role="dialog"
      aria-modal="true"
      aria-label={`Z Report for ${date}`}
    >
      <div className="bg-[#0F172A] border border-slate-700 rounded-2xl w-full max-w-2xl my-4 flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-700">
          <div>
            <h2
              className="text-xl font-bold text-white"
              style={{ fontFamily: "'Playfair Display SC', serif" }}
            >
              Z Report
            </h2>
            <p className="text-slate-400 text-sm mt-0.5">{date}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-slate-400 hover:text-white transition-colors cursor-pointer p-1 rounded-lg hover:bg-slate-700"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-5 space-y-6">
          {loading && (
            <p className="text-slate-400 text-sm text-center py-12">Loading Z report…</p>
          )}

          {error && (
            <p className="text-red-400 text-sm text-center py-12">{error}</p>
          )}

          {data && (
            <>
              {/* Section 1: Sales Summary */}
              <section aria-labelledby="z-sales-heading">
                <h3
                  id="z-sales-heading"
                  className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3"
                >
                  Sales Summary
                </h3>
                <div className="bg-slate-800/60 rounded-xl p-4 space-y-2">
                  <Row label="Total Revenue">
                    <span className="text-green-400 font-bold text-lg" data-testid="z-total-revenue">
                      {fmt(data.salesSummary.totalRevenue)}
                    </span>
                  </Row>
                  <Row label="Transactions">
                    <span className="text-white font-semibold" data-testid="z-transaction-count">
                      {data.salesSummary.transactionCount}
                    </span>
                  </Row>
                  <div className="border-t border-slate-700/50 my-1" />
                  <Row label={<><Banknote size={13} className="inline mr-1 text-green-400" aria-hidden="true" />Cash</>}>
                    <span className="text-white text-sm" data-testid="z-cash-total">
                      {fmt(data.salesSummary.cashTotal)}
                    </span>
                  </Row>
                  <Row label={<><CreditCard size={13} className="inline mr-1 text-blue-400" aria-hidden="true" />Card</>}>
                    <span className="text-white text-sm" data-testid="z-card-total">
                      {fmt(data.salesSummary.cardTotal)}
                    </span>
                  </Row>
                  <Row label={<><Receipt size={13} className="inline mr-1 text-slate-400" aria-hidden="true" />Tab</>}>
                    <span className="text-white text-sm" data-testid="z-tab-total">
                      {fmt(data.salesSummary.tabTotal)}
                    </span>
                  </Row>
                  <div className="border-t border-slate-700/50 my-1" />
                  <Row label="Refunds">
                    <span className="text-red-400 text-sm" data-testid="z-refunds-total">
                      {fmt(-data.salesSummary.refundsTotal)}
                    </span>
                  </Row>
                  <Row label="Net Revenue">
                    <span className="text-white font-semibold" data-testid="z-net-revenue">
                      {fmt(data.salesSummary.netRevenue)}
                    </span>
                  </Row>
                </div>
              </section>

              {/* Section 2: Top Products */}
              <section aria-labelledby="z-products-heading">
                <h3
                  id="z-products-heading"
                  className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3"
                >
                  Top Products
                </h3>
                <div className="bg-slate-800/60 rounded-xl p-4">
                  {data.topProducts.length === 0 ? (
                    <p className="text-slate-500 text-sm text-center py-4">No product sales for this date.</p>
                  ) : (
                    <ol className="divide-y divide-slate-700/50" aria-label="Top products by revenue">
                      {data.topProducts.map((p, i) => (
                        <li key={i} className="flex items-center gap-3 py-2.5">
                          <span className="w-5 text-right text-slate-500 text-xs font-mono shrink-0" aria-hidden="true">
                            {i + 1}
                          </span>
                          <span className="flex-1 text-white text-sm truncate">{p.name}</span>
                          <span
                            className="text-slate-400 text-xs tabular-nums shrink-0"
                            data-testid={`z-product-qty-${i}`}
                          >
                            ×{p.qty}
                          </span>
                          <span
                            className="text-green-400 text-sm font-semibold shrink-0 tabular-nums"
                            data-testid={`z-product-revenue-${i}`}
                          >
                            {fmt(p.revenue)}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </section>

              {/* Section 3: Cash Reconciliation */}
              <section aria-labelledby="z-cash-heading">
                <h3
                  id="z-cash-heading"
                  className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3"
                >
                  Cash Reconciliation
                </h3>
                <div className="bg-slate-800/60 rounded-xl p-4 space-y-3">
                  {/* Opening float */}
                  <div className="flex items-center justify-between gap-4">
                    <label
                      htmlFor="z-opening-float"
                      className="text-slate-300 text-sm shrink-0"
                    >
                      Opening Float
                    </label>
                    <div className="flex items-center gap-1">
                      <span className="text-slate-400 text-sm">£</span>
                      <input
                        id="z-opening-float"
                        type="number"
                        min="0"
                        step="0.01"
                        value={openingFloat}
                        onChange={e => setOpeningFloat(parseFloat(e.target.value) || 0)}
                        aria-label="Opening float"
                        className="w-24 bg-slate-700 border border-slate-600 rounded-lg px-2 py-1.5 text-white text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  {/* Cash sales (auto) */}
                  <Row label="Cash Sales">
                    <span className="text-white text-sm tabular-nums">{fmt(cashSales)}</span>
                  </Row>

                  {/* Expected in till */}
                  <Row label="Expected in Till">
                    <span className="text-white font-semibold tabular-nums" data-testid="z-expected-till">
                      {fmt(expectedInTill)}
                    </span>
                  </Row>

                  <div className="border-t border-slate-700/50 my-1" />

                  {/* Actual cash */}
                  <div className="flex items-center justify-between gap-4">
                    <label
                      htmlFor="z-actual-cash"
                      className="text-slate-300 text-sm shrink-0"
                    >
                      Actual Cash
                    </label>
                    <div className="flex items-center gap-1">
                      <span className="text-slate-400 text-sm">£</span>
                      <input
                        id="z-actual-cash"
                        type="number"
                        min="0"
                        step="0.01"
                        value={actualCash}
                        onChange={e => setActualCash(parseFloat(e.target.value) || 0)}
                        aria-label="Actual cash"
                        className="w-24 bg-slate-700 border border-slate-600 rounded-lg px-2 py-1.5 text-white text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  {/* Variance */}
                  <Row label="Variance">
                    <span
                      data-testid="z-variance"
                      className={`font-bold tabular-nums ${variance >= 0 ? 'text-green-400' : 'text-red-400'}`}
                    >
                      {fmt(variance)}
                    </span>
                  </Row>
                </div>
              </section>

              {closeError && (
                <p className="text-red-400 text-sm text-center">{closeError}</p>
              )}
            </>
          )}
        </div>

        {/* Footer actions */}
        {data && (
          <div className="flex items-center justify-end gap-3 p-5 border-t border-slate-700">
            <button
              onClick={handleExportCSV}
              className="flex items-center gap-2 px-4 min-h-[44px] rounded-xl bg-slate-700 hover:bg-slate-600 border border-slate-600 text-white text-sm font-semibold transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
            >
              <Download size={15} aria-hidden="true" />
              Export CSV
            </button>
            <button
              onClick={handleCloseDay}
              disabled={closing}
              className="flex items-center gap-2 px-4 min-h-[44px] rounded-xl bg-red-800 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
            >
              <Lock size={15} aria-hidden="true" />
              {closing ? 'Closing…' : 'Close Day'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-slate-400 text-sm">{label}</span>
      {children}
    </div>
  )
}
