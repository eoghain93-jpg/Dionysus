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
      className="ui-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`Z Report for ${date}`}
    >
      <div className="ui-modal max-w-3xl p-0 gap-0 overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 md:px-6 py-4 border-b border-slate-800">
          <div>
            <h2 className="ui-modal-title">
              Z Report
            </h2>
            <p className="ui-subtitle mt-0.5">{date}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="ui-btn ui-btn-ghost ui-btn-icon shrink-0"
          >
            <X size={22} aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-auto px-5 md:px-6 py-5 space-y-6">
          {loading && (
            <p className="ui-empty">Loading Z report…</p>
          )}

          {error && (
            <p className="ui-banner ui-banner-bad">{error}</p>
          )}

          {data && (
            <>
              <section aria-labelledby="z-sales-heading">
                <h3 id="z-sales-heading" className={SECTION_HEADING}>
                  Sales Summary
                </h3>
                <div className={`${PANEL} space-y-2.5`}>
                  <Row label="Total Revenue">
                    <span className="text-white font-extrabold text-[28px] leading-tight" data-testid="z-total-revenue">
                      {fmt(data.salesSummary.totalRevenue)}
                    </span>
                  </Row>
                  <Row label="Transactions">
                    <span className={VALUE_STRONG} data-testid="z-transaction-count">
                      {data.salesSummary.transactionCount}
                    </span>
                  </Row>
                  <Divider />
                  <Row label={<><Banknote size={16} className="inline mr-1.5 text-emerald-300" aria-hidden="true" />Cash</>}>
                    <span className={VALUE} data-testid="z-cash-total">
                      {fmt(data.salesSummary.cashTotal)}
                    </span>
                  </Row>
                  <Row label={<><CreditCard size={16} className="inline mr-1.5 text-blue-400" aria-hidden="true" />Card</>}>
                    <span className={VALUE} data-testid="z-card-total">
                      {fmt(data.salesSummary.cardTotal)}
                    </span>
                  </Row>
                  <Divider />
                  <Row label="Refunds">
                    <span className="text-red-300 text-base font-semibold" data-testid="z-refunds-total">
                      {fmt(-data.salesSummary.refundsTotal)}
                    </span>
                  </Row>
                  <Row label="Net Revenue">
                    <span className={VALUE_STRONG} data-testid="z-net-revenue">
                      {fmt(data.salesSummary.netRevenue)}
                    </span>
                  </Row>
                  <Divider />
                  <Row label={<span className="text-slate-300 font-semibold">Week to Date</span>}>
                    <span className={VALUE_STRONG}>
                      {fmt(data.weekToDateRevenue ?? 0)}
                    </span>
                  </Row>
                  <Row label={<span className="text-slate-300 font-semibold">Outstanding Tabs</span>}>
                    <span className="text-amber-300 text-[17px] font-extrabold">
                      {fmt(data.outstandingTabs ?? 0)}
                    </span>
                  </Row>
                </div>
              </section>

              <section aria-labelledby="z-products-heading">
                <h3 id="z-products-heading" className={SECTION_HEADING}>
                  Top Products
                </h3>
                <div className="bg-slate-800 rounded-2xl">
                  {data.topProducts.length === 0 ? (
                    <p className="ui-empty py-6">No product sales for this date.</p>
                  ) : (
                    <ol className="divide-y divide-slate-700" aria-label="Top products by revenue">
                      {data.topProducts.map((p, i) => (
                        <li key={i} className="flex items-center gap-3 px-4 py-3">
                          <span className="w-6 text-right text-slate-400 text-[15px] font-bold shrink-0" aria-hidden="true">
                            {i + 1}
                          </span>
                          <span className="flex-1 min-w-0 text-white text-base font-semibold truncate">{p.name}</span>
                          <span
                            className="text-slate-300 text-[15px] shrink-0"
                            data-testid={`z-product-qty-${i}`}
                          >
                            ×{p.qty}
                          </span>
                          <span
                            className="text-white text-base font-extrabold shrink-0 w-20 text-right"
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
                  <h3 id="z-week-heading" className={SECTION_HEADING}>
                    Week Summary <span className="text-slate-400 text-[15px] font-semibold ml-2">{data.weekSummary.weekStart} → {data.weekSummary.weekEnd}</span>
                  </h3>
                  <div className={`${PANEL} space-y-3`}>
                    {/* Daily breakdown — cash / card / total */}
                    <div className="overflow-x-auto">
                      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 gap-y-1.5 text-[15px] min-w-[340px]">
                        <span className={COL_HEAD}>Day</span>
                        <span className={`${COL_HEAD} text-right`}>Cash</span>
                        <span className={`${COL_HEAD} text-right`}>Card</span>
                        <span className={`${COL_HEAD} text-right`}>Total</span>
                        {data.weekSummary.daily.map(d => (
                          <Fragment key={d.date}>
                            <span className="text-slate-300 self-center whitespace-nowrap">
                              {new Date(`${d.date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                            </span>
                            <span className="text-slate-300 text-right">{fmt(d.cash)}</span>
                            <span className="text-slate-300 text-right">{fmt(d.card)}</span>
                            <span className="text-white font-semibold text-right">{fmt(d.total)}</span>
                          </Fragment>
                        ))}
                        <span className="col-span-4 border-t border-slate-700 mt-1" />
                        <span className="text-white font-extrabold self-center">Total</span>
                        <span className="text-white font-bold text-right">
                          {fmt(data.weekSummary.daily.reduce((s, d) => s + d.cash, 0))}
                        </span>
                        <span className="text-white font-bold text-right">
                          {fmt(data.weekSummary.daily.reduce((s, d) => s + d.card, 0))}
                        </span>
                        <span className="text-white font-extrabold text-right">
                          {fmt(data.weekSummary.weekRevenue)}
                        </span>
                      </div>
                    </div>
                    <Row label="Last Week">
                      <span className="text-slate-300 text-base">{fmt(data.weekSummary.previousWeekRevenue)}</span>
                    </Row>
                    {data.weekSummary.weekOnWeekDelta != null && (
                      <Row label="Change">
                        <span className={`text-base font-bold ${data.weekSummary.weekOnWeekDelta >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                          {data.weekSummary.weekOnWeekDelta >= 0 ? '+' : ''}{data.weekSummary.weekOnWeekDelta.toFixed(1)}%
                        </span>
                      </Row>
                    )}
                    <Divider />
                    <Row label="Wastage (week)"><span className="text-red-300 text-base font-semibold">{fmt(data.weekSummary.wastageTotal)}</span></Row>
                    <Row label="Staff Drinks (week)"><span className="text-amber-300 text-base font-semibold">{fmt(data.weekSummary.staffDrinksTotal)}</span></Row>
                    {data.weekSummary.topProducts.length > 0 && (
                      <>
                        <Divider />
                        <p className={COL_HEAD}>Top sellers (week)</p>
                        <ol className="space-y-1.5">
                          {data.weekSummary.topProducts.map((p, i) => (
                            <li key={i} className="flex items-center gap-2.5 text-[15px]">
                              <span className="text-slate-400 font-bold w-5 text-right">{i + 1}</span>
                              <span className="flex-1 min-w-0 text-white truncate">{p.name}</span>
                              <span className="text-slate-300">×{p.qty}</span>
                              <span className="text-white font-bold w-20 text-right">{fmt(p.revenue)}</span>
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
                valueClass="text-red-300"
              />

              <ReportSection
                id="z-staff-heading"
                title="Staff Drinks"
                items={data.staffDrinks}
                renderLabel={s => (
                  <><span>{s.name}</span><span className="text-slate-400 text-sm ml-1.5">({s.items} item{s.items !== 1 ? 's' : ''})</span></>
                )}
                valueClass="text-amber-300"
              />

              <section aria-labelledby="z-cash-heading">
                <h3 id="z-cash-heading" className={SECTION_HEADING}>
                  Cash Reconciliation
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
                <div className="border border-slate-700 rounded-2xl p-4 mt-3 space-y-2.5">
                  <p className="text-white text-[17px] font-extrabold">Combined</p>
                  <Row label="Total Expected">
                    <span className={VALUE_STRONG} data-testid="z-expected-till">
                      {fmt(expectedInTill)}
                    </span>
                  </Row>
                  <Row label="Total Actual Cash">
                    <span className={VALUE_STRONG}>{fmt(actualCash)}</span>
                  </Row>
                  <Row label="Total Variance">
                    <span
                      data-testid="z-variance"
                      className={`text-[22px] leading-tight font-extrabold ${variance >= 0 ? 'text-green-400' : 'text-red-400'}`}
                    >
                      {fmt(variance)}
                    </span>
                  </Row>
                  {prizeWinsTotal > 0 && (
                    <div className="pt-2.5 border-t border-slate-700 space-y-1.5 text-[15px]">
                      <div className="flex justify-between gap-3">
                        <span className="text-slate-400">Prize Wins · Machine 1</span>
                        <span className="text-red-300" data-testid="z-prize-wins-m1">
                          -{fmt(data.prizeWins?.machine1 ?? 0)}
                        </span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="text-slate-400">Prize Wins · Machine 2</span>
                        <span className="text-red-300" data-testid="z-prize-wins-m2">
                          -{fmt(data.prizeWins?.machine2 ?? 0)}
                        </span>
                      </div>
                    </div>
                  )}
                  <span data-testid="z-prize-wins-total" className="hidden">-{fmt(prizeWinsTotal)}</span>
                </div>
              </section>

              {closeError && (
                <p className="ui-banner ui-banner-bad">{closeError}</p>
              )}
            </>
          )}
        </div>

        {/* Footer actions */}
        {data && (
          <div className="flex flex-wrap items-center justify-end gap-3 px-5 md:px-6 py-4 border-t border-slate-800">
            <button
              onClick={handleExportCSV}
              className="ui-btn ui-btn-secondary ui-btn-lg flex-1 sm:flex-none"
            >
              <Download size={20} aria-hidden="true" />
              Export CSV
            </button>
            <button
              onClick={handleCloseDay}
              disabled={closing}
              className="ui-btn ui-btn-primary ui-btn-lg flex-1 sm:flex-none"
            >
              <Lock size={20} aria-hidden="true" />
              {closing ? 'Closing…' : 'Close Day'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

const SECTION_HEADING = 'ui-section-title mb-3'
const PANEL = 'bg-slate-800 rounded-2xl p-4'
const COL_HEAD = 'text-slate-400 text-[13px] font-bold uppercase tracking-wide'
const VALUE = 'text-white text-base font-semibold'
const VALUE_STRONG = 'text-white text-[17px] font-extrabold'
const MONEY_INPUT = 'ui-input w-28 px-3 text-right font-bold bg-slate-900'

function Divider() {
  return <div className="border-t border-slate-700" />
}

function Row({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-slate-300 text-base">{label}</span>
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
    <div className={`${PANEL} space-y-3`}>
      <p className="text-white text-[17px] font-extrabold">{title}</p>

      <div className="flex items-center justify-between gap-4">
        <label htmlFor={floatId} className="text-slate-100 text-base font-semibold shrink-0">
          Opening Float
        </label>
        <div className="flex items-center gap-1.5">
          <span className="text-slate-400 text-base font-bold">£</span>
          <input
            id={floatId}
            type="number"
            min="0"
            step="0.01"
            value={floatValue}
            onChange={e => onFloatChange(parseFloat(e.target.value) || 0)}
            onFocus={e => e.target.select()}
            aria-label={floatLabel}
            className={MONEY_INPUT}
          />
        </div>
      </div>

      <Row label="Cash Received">
        <span className={VALUE}>{fmt(cashSales)}</span>
      </Row>

      <Row label="Card Received">
        <span className={VALUE}>{fmt(cardSales ?? 0)}</span>
      </Row>

      <Row label="Cashback Given">
        <span className={`text-base ${cashback > 0 ? 'text-red-300 font-bold' : 'text-slate-400'}`}>
          {cashback > 0 ? `-${fmt(cashback)}` : '—'}
        </span>
      </Row>

      <Row label="Prize Wins Paid Out">
        <span className={`text-base ${prizeWins > 0 ? 'text-red-300 font-bold' : 'text-slate-400'}`}>
          {prizeWins > 0 ? `-${fmt(prizeWins)}` : '—'}
        </span>
      </Row>

      <Divider />

      <Row label="Expected in Till">
        <span className={VALUE_STRONG}>{fmt(expected)}</span>
      </Row>

      <div className="flex items-center justify-between gap-4">
        <label htmlFor={actualId} className="text-slate-100 text-base font-semibold shrink-0">
          Actual Cash
        </label>
        <div className="flex items-center gap-1.5">
          <span className="text-slate-400 text-base font-bold">£</span>
          <input
            id={actualId}
            type="number"
            min="0"
            step="0.01"
            value={actualValue}
            onChange={e => onActualChange(parseFloat(e.target.value) || 0)}
            onFocus={e => e.target.select()}
            aria-label={actualLabel}
            className={MONEY_INPUT}
          />
        </div>
      </div>

      <Row label="Variance">
        <span className={`text-[17px] font-extrabold ${variance >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
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
      <h3 id={id} className={SECTION_HEADING}>
        {title}
      </h3>
      <div className={`${PANEL} space-y-2.5`}>
        {items.map((item, i) => (
          <Row key={i} label={renderLabel(item)}>
            <span className={`${valueClass} text-base font-semibold`}>{fmt(item.value)}</span>
          </Row>
        ))}
      </div>
    </section>
  )
}
