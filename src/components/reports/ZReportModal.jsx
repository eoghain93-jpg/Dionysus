import { useState, useEffect, Fragment } from 'react'
import { supabase } from '../../lib/supabase'
import { fetchZReportData } from '../../lib/zReport'
import { useSessionStore } from '../../stores/sessionStore'
import { X, Download, Lock, CreditCard, Banknote } from '../../lib/icons'

function fmt(n) {
  if (n === undefined || n === null) return '£0.00'
  const abs = Math.abs(n).toFixed(2)
  return n < 0 ? `-£${abs}` : `£${abs}`
}

export default function ZReportModal({ date, onClose, onDayClose }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [data, setData] = useState(null)
  // £200 is the standard opening float for till 1, £120 for till 2 — pre-filled
  // so staff don't have to type them. Set till 2 to 0 on days it wasn't run.
  const [openingFloat, setOpeningFloat] = useState(200)
  const [till2OpeningFloat, setTill2OpeningFloat] = useState(120)
  const [till1Actual, setTill1Actual] = useState(0)
  const [till2Actual, setTill2Actual] = useState(0)
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

  // Per-till breakdowns — default to 0 when no data on that till
  const cashByTill = data?.salesSummary?.cashTotalByTill ?? { 'till-1': 0, 'till-2': 0 }
  const cardByTill = data?.salesSummary?.cardTotalByTill ?? { 'till-1': 0, 'till-2': 0 }
  const cashbackByTill = data?.cashbackByTill ?? { 'till-1': 0, 'till-2': 0 }
  const prizeByTill = data?.prizeWins?.byTill ?? { 'till-1': 0, 'till-2': 0 }
  const till1Cash = cashByTill['till-1'] ?? 0
  const till2Cash = cashByTill['till-2'] ?? 0
  const till1Card = cardByTill['till-1'] ?? 0
  const till2Card = cardByTill['till-2'] ?? 0
  const till1Cashback = cashbackByTill['till-1'] ?? 0
  const till2Cashback = cashbackByTill['till-2'] ?? 0
  const till1Prize = prizeByTill['till-1'] ?? 0
  const till2Prize = prizeByTill['till-2'] ?? 0

  // Per-till reconciliation. Each till is its own variance source — combining
  // them masks compensating errors (till 1 +£5, till 2 -£5 → looks fine).
  const till1Expected = openingFloat + till1Cash - till1Cashback - till1Prize
  const till2Expected = till2OpeningFloat + till2Cash - till2Cashback - till2Prize
  const till1Variance = till1Actual - till1Expected
  const till2Variance = till2Actual - till2Expected

  // Combined totals — used by the existing single-float DB column and by
  // anyone glancing at the bottom line.
  const cashSales = data?.salesSummary?.cashTotal ?? 0
  const cashbackTotal = data?.cashbackTotal ?? 0
  const prizeWinsTotal = data?.prizeWins?.total ?? 0
  const combinedFloat = openingFloat + till2OpeningFloat
  const expectedInTill = till1Expected + till2Expected
  const actualCash = till1Actual + till2Actual
  const variance = till1Variance + till2Variance

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
      `Refunds,-${s.refundsTotal.toFixed(2)}`,
      `Net Revenue,${s.netRevenue.toFixed(2)}`,
      '',
      'Top Products',
      'Name,Qty,Revenue',
      ...topProducts.map(p => `${p.name},${p.qty},${p.revenue.toFixed(2)}`),
      '',
      'Cash Reconciliation — Till 1',
      `Opening Float,${openingFloat.toFixed(2)}`,
      `Cash Received,${till1Cash.toFixed(2)}`,
      `Card Received,${till1Card.toFixed(2)}`,
      `Cashback Given,-${till1Cashback.toFixed(2)}`,
      `Prize Wins Paid Out,-${till1Prize.toFixed(2)}`,
      `Expected in Till,${till1Expected.toFixed(2)}`,
      `Actual Cash,${till1Actual.toFixed(2)}`,
      `Variance,${till1Variance.toFixed(2)}`,
      '',
      'Cash Reconciliation — Till 2',
      `Opening Float,${till2OpeningFloat.toFixed(2)}`,
      `Cash Received,${till2Cash.toFixed(2)}`,
      `Card Received,${till2Card.toFixed(2)}`,
      `Cashback Given,-${till2Cashback.toFixed(2)}`,
      `Prize Wins Paid Out,-${till2Prize.toFixed(2)}`,
      `Expected in Till,${till2Expected.toFixed(2)}`,
      `Actual Cash,${till2Actual.toFixed(2)}`,
      `Variance,${till2Variance.toFixed(2)}`,
      '',
      'Cash Reconciliation — Combined',
      `Opening Float,${combinedFloat.toFixed(2)}`,
      `Cash Sales,${cashSales.toFixed(2)}`,
      `Cashback Given,-${(data.cashbackTotal ?? 0).toFixed(2)}`,
      `Prize Wins Paid Out,-${prizeWinsTotal.toFixed(2)}`,
      `  Machine 1,-${(data.prizeWins?.machine1 ?? 0).toFixed(2)}`,
      `  Machine 2,-${(data.prizeWins?.machine2 ?? 0).toFixed(2)}`,
      `Expected in Till,${expectedInTill.toFixed(2)}`,
      `Actual Cash,${actualCash.toFixed(2)}`,
      `Variance,${variance.toFixed(2)}`,
    ]
    if (data.wastage?.length > 0) {
      lines.push('', 'Wastage', 'Product,Quantity,Value')
      data.wastage.forEach(w => lines.push(`${w.name},${w.quantity},${w.value.toFixed(2)}`))
    }
    if (data.staffDrinks?.length > 0) {
      lines.push('', 'Staff Drinks', 'Staff,Items,Value')
      data.staffDrinks.forEach(s => lines.push(`${s.name},${s.items},${s.value.toFixed(2)}`))
    }
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
        openingFloat: combinedFloat,
        till1OpeningFloat: openingFloat,
        till2OpeningFloat,
        cashSales,
        cashbackTotal,
        prizeWinsTotal,
        expectedInTill,
        actualCash,
        variance,
        // Per-till breakdown so the email can render two reconciliation
        // sections plus a combined footer.
        perTill: {
          till1: {
            openingFloat,
            cashSales: till1Cash,
            cardSales: till1Card,
            cashbackTotal: till1Cashback,
            prizeWinsTotal: till1Prize,
            expectedInTill: till1Expected,
            actualCash: till1Actual,
            variance: till1Variance,
          },
          till2: {
            openingFloat: till2OpeningFloat,
            cashSales: till2Cash,
            cardSales: till2Card,
            cashbackTotal: till2Cashback,
            prizeWinsTotal: till2Prize,
            expectedInTill: till2Expected,
            actualCash: till2Actual,
            variance: till2Variance,
          },
        },
      }

      // 1. Upsert z_reports row (idempotent — retry-safe if email failed previously)
      const { error: dbErr } = await supabase
        .from('z_reports')
        .upsert({
          report_date: date,
          opening_float: combinedFloat,
          actual_cash: actualCash,
          closed_at: new Date().toISOString(),
        }, { onConflict: 'report_date' })

      if (dbErr) throw new Error(dbErr.message)

      // 2. Email report
      const { error: emailErr } = await supabase.functions.invoke('send-z-report', {
        body: {
          reportDate: date,
          salesSummary: s,
          topProducts,
          cashReconciliation: reconciliation,
          wastage: data.wastage ?? [],
          staffDrinks: data.staffDrinks ?? [],
          prizeWins: data.prizeWins ?? { total: 0, machine1: 0, machine2: 0 },
          weekToDateRevenue: data.weekToDateRevenue ?? 0,
          outstandingTabs: data.outstandingTabs ?? 0,
          weekSummary: data.weekSummary ?? null,
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
                  <div className="border-t border-slate-700/50 my-1" />
                  <Row label={<span className="text-slate-300 font-medium">Week to Date</span>}>
                    <span className="text-emerald-400 font-bold tabular-nums">
                      {fmt(data.weekToDateRevenue ?? 0)}
                    </span>
                  </Row>
                  <Row label={<span className="text-slate-300 font-medium">Outstanding Tabs</span>}>
                    <span className="text-amber-400 font-bold tabular-nums">
                      {fmt(data.outstandingTabs ?? 0)}
                    </span>
                  </Row>
                </div>
              </section>

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

              {data.weekSummary && (
                <section aria-labelledby="z-week-heading">
                  <h3 id="z-week-heading" className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">
                    Week Summary <span className="text-slate-500 text-xs ml-2 normal-case">{data.weekSummary.weekStart} → {data.weekSummary.weekEnd}</span>
                  </h3>
                  <div className="bg-slate-800/60 rounded-xl p-4 space-y-3">
                    {/* Daily breakdown — cash / card / total */}
                    <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 gap-y-1 text-sm tabular-nums">
                      <span className="text-slate-500 text-xs uppercase tracking-wide">Day</span>
                      <span className="text-slate-500 text-xs uppercase tracking-wide text-right">Cash</span>
                      <span className="text-slate-500 text-xs uppercase tracking-wide text-right">Card</span>
                      <span className="text-slate-500 text-xs uppercase tracking-wide text-right">Total</span>
                      {data.weekSummary.daily.map(d => (
                        <Fragment key={d.date}>
                          <span className="text-slate-400 text-xs self-center">
                            {new Date(`${d.date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                          </span>
                          <span className="text-slate-300 text-right">{fmt(d.cash)}</span>
                          <span className="text-slate-300 text-right">{fmt(d.card)}</span>
                          <span className="text-white text-right">{fmt(d.total)}</span>
                        </Fragment>
                      ))}
                      <span className="col-span-4 border-t border-slate-700/50 mt-1" />
                      <span className="text-slate-300 text-xs font-semibold uppercase tracking-wide self-center">Total</span>
                      <span className="text-emerald-400 font-semibold text-right">
                        {fmt(data.weekSummary.daily.reduce((s, d) => s + d.cash, 0))}
                      </span>
                      <span className="text-emerald-400 font-semibold text-right">
                        {fmt(data.weekSummary.daily.reduce((s, d) => s + d.card, 0))}
                      </span>
                      <span className="text-emerald-400 font-bold text-right">
                        {fmt(data.weekSummary.weekRevenue)}
                      </span>
                    </div>
                    <Row label="Last Week">
                      <span className="text-slate-400 text-sm tabular-nums">{fmt(data.weekSummary.previousWeekRevenue)}</span>
                    </Row>
                    {data.weekSummary.weekOnWeekDelta != null && (
                      <Row label="Change">
                        <span className={`text-sm font-semibold tabular-nums ${data.weekSummary.weekOnWeekDelta >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {data.weekSummary.weekOnWeekDelta >= 0 ? '+' : ''}{data.weekSummary.weekOnWeekDelta.toFixed(1)}%
                        </span>
                      </Row>
                    )}
                    <div className="border-t border-slate-700/50" />
                    <Row label="Wastage (week)"><span className="text-red-400 text-sm tabular-nums">{fmt(data.weekSummary.wastageTotal)}</span></Row>
                    <Row label="Staff Drinks (week)"><span className="text-orange-400 text-sm tabular-nums">{fmt(data.weekSummary.staffDrinksTotal)}</span></Row>
                    {data.weekSummary.topProducts.length > 0 && (
                      <>
                        <div className="border-t border-slate-700/50" />
                        <p className="text-slate-400 text-xs uppercase tracking-wide">Top sellers (week)</p>
                        <ol className="space-y-1">
                          {data.weekSummary.topProducts.map((p, i) => (
                            <li key={i} className="flex items-center gap-2 text-sm">
                              <span className="text-slate-500 text-xs font-mono w-5 text-right">{i + 1}</span>
                              <span className="flex-1 text-white truncate">{p.name}</span>
                              <span className="text-slate-400 text-xs tabular-nums">×{p.qty}</span>
                              <span className="text-emerald-400 text-sm tabular-nums">{fmt(p.revenue)}</span>
                            </li>
                          ))}
                        </ol>
                      </>
                    )}
                  </div>
                </section>
              )}

              <ReportSection
                id="z-wastage-heading"
                title="Wastage"
                items={data.wastage}
                renderLabel={w => `${w.name} ×${w.quantity}`}
                valueClass="text-red-400"
              />

              <ReportSection
                id="z-staff-heading"
                title="Staff Drinks"
                items={data.staffDrinks}
                renderLabel={s => (
                  <><span>{s.name}</span><span className="text-slate-500 text-xs ml-1">({s.items} item{s.items !== 1 ? 's' : ''})</span></>
                )}
                valueClass="text-orange-400"
              />

              <section aria-labelledby="z-cash-heading">
                <h3
                  id="z-cash-heading"
                  className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3"
                >
                  Cash Reconciliation
                </h3>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <TillReconciliationCard
                    title="Till 1"
                    floatId="z-opening-float"
                    floatLabel="Opening float till 1"
                    floatValue={openingFloat}
                    onFloatChange={setOpeningFloat}
                    cashSales={till1Cash}
                    cardSales={till1Card}
                    cashback={till1Cashback}
                    prizeWins={till1Prize}
                    expected={till1Expected}
                    actualId="z-actual-cash"
                    actualLabel="Actual cash till 1"
                    actualValue={till1Actual}
                    onActualChange={setTill1Actual}
                    variance={till1Variance}
                  />
                  <TillReconciliationCard
                    title="Till 2"
                    floatId="z-opening-float-till2"
                    floatLabel="Opening float till 2"
                    floatValue={till2OpeningFloat}
                    onFloatChange={setTill2OpeningFloat}
                    cashSales={till2Cash}
                    cardSales={till2Card}
                    cashback={till2Cashback}
                    prizeWins={till2Prize}
                    expected={till2Expected}
                    actualId="z-actual-cash-till2"
                    actualLabel="Actual cash till 2"
                    actualValue={till2Actual}
                    onActualChange={setTill2Actual}
                    variance={till2Variance}
                  />
                </div>

                {/* Combined footer — visible at-a-glance totals */}
                <div className="bg-slate-900/60 border border-slate-700 rounded-xl p-4 mt-3 space-y-2">
                  <p className="text-xs text-slate-400 uppercase tracking-wide">Combined</p>
                  <Row label="Total Expected">
                    <span className="text-white font-semibold tabular-nums" data-testid="z-expected-till">
                      {fmt(expectedInTill)}
                    </span>
                  </Row>
                  <Row label="Total Actual Cash">
                    <span className="text-white font-semibold tabular-nums">{fmt(actualCash)}</span>
                  </Row>
                  <Row label="Total Variance">
                    <span
                      data-testid="z-variance"
                      className={`font-bold tabular-nums ${variance >= 0 ? 'text-green-400' : 'text-red-400'}`}
                    >
                      {fmt(variance)}
                    </span>
                  </Row>
                  {prizeWinsTotal > 0 && (
                    <div className="pl-1 pt-1 border-t border-slate-700/50 space-y-1 text-xs">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Prize Wins · Machine 1</span>
                        <span className="text-red-400/80" data-testid="z-prize-wins-m1">
                          -{fmt(data.prizeWins?.machine1 ?? 0)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Prize Wins · Machine 2</span>
                        <span className="text-red-400/80" data-testid="z-prize-wins-m2">
                          -{fmt(data.prizeWins?.machine2 ?? 0)}
                        </span>
                      </div>
                    </div>
                  )}
                  <span data-testid="z-prize-wins-total" className="hidden">-{fmt(prizeWinsTotal)}</span>
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

function TillReconciliationCard({
  title, floatId, floatLabel, floatValue, onFloatChange,
  cashSales, cardSales, cashback, prizeWins, expected,
  actualId, actualLabel, actualValue, onActualChange, variance,
}) {
  return (
    <div className="bg-slate-800/60 rounded-xl p-4 space-y-3">
      <p className="text-xs text-slate-400 uppercase tracking-wide">{title}</p>

      <div className="flex items-center justify-between gap-4">
        <label htmlFor={floatId} className="text-slate-300 text-sm shrink-0">
          Opening Float
        </label>
        <div className="flex items-center gap-1">
          <span className="text-slate-400 text-sm">£</span>
          <input
            id={floatId}
            type="number"
            min="0"
            step="0.01"
            value={floatValue}
            onChange={e => onFloatChange(parseFloat(e.target.value) || 0)}
            onFocus={e => e.target.select()}
            aria-label={floatLabel}
            className="w-24 bg-slate-700 border border-slate-600 rounded-lg px-2 py-1.5 text-white text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <Row label="Cash Received">
        <span className="text-white text-sm tabular-nums">{fmt(cashSales)}</span>
      </Row>

      <Row label="Card Received">
        <span className="text-white text-sm tabular-nums">{fmt(cardSales ?? 0)}</span>
      </Row>

      <Row label="Cashback Given">
        <span className={`text-sm tabular-nums ${cashback > 0 ? 'text-red-400 font-semibold' : 'text-slate-500'}`}>
          {cashback > 0 ? `-${fmt(cashback)}` : '—'}
        </span>
      </Row>

      <Row label="Prize Wins Paid Out">
        <span className={`text-sm tabular-nums ${prizeWins > 0 ? 'text-red-400 font-semibold' : 'text-slate-500'}`}>
          {prizeWins > 0 ? `-${fmt(prizeWins)}` : '—'}
        </span>
      </Row>

      <div className="border-t border-slate-700/50 my-1" />

      <Row label="Expected in Till">
        <span className="text-white font-semibold tabular-nums">{fmt(expected)}</span>
      </Row>

      <div className="flex items-center justify-between gap-4">
        <label htmlFor={actualId} className="text-slate-300 text-sm shrink-0">
          Actual Cash
        </label>
        <div className="flex items-center gap-1">
          <span className="text-slate-400 text-sm">£</span>
          <input
            id={actualId}
            type="number"
            min="0"
            step="0.01"
            value={actualValue}
            onChange={e => onActualChange(parseFloat(e.target.value) || 0)}
            onFocus={e => e.target.select()}
            aria-label={actualLabel}
            className="w-24 bg-slate-700 border border-slate-600 rounded-lg px-2 py-1.5 text-white text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <Row label="Variance">
        <span className={`font-bold tabular-nums ${variance >= 0 ? 'text-green-400' : 'text-red-400'}`}>
          {fmt(variance)}
        </span>
      </Row>
    </div>
  )
}

function ReportSection({ id, title, items, renderLabel, valueClass }) {
  if (!items?.length) return null
  return (
    <section aria-labelledby={id}>
      <h3 id={id} className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">
        {title}
      </h3>
      <div className="bg-slate-800/60 rounded-xl p-4 space-y-2">
        {items.map((item, i) => (
          <Row key={i} label={renderLabel(item)}>
            <span className={`${valueClass} text-sm tabular-nums`}>{fmt(item.value)}</span>
          </Row>
        ))}
      </div>
    </section>
  )
}
