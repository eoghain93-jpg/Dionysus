import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import MonthlyReportPage from './MonthlyReportPage'
import { fetchMonthlyReportData } from '../lib/monthlyReport'
import { supabase } from '../lib/supabase'
import { logEvent } from '../lib/audit/log'

vi.mock('../lib/audit/log', () => ({ logEvent: vi.fn() }))
vi.mock('../lib/monthlyReport', () => ({
  fetchMonthlyReportData: vi.fn(),
  toCsv: vi.fn(() => 'Date,Cash,Card\n2026-02-01,100,200\n2026-02-02,50,75\n2026-02-03,10,20'),
  monthLabel: m => m,
}))
vi.mock('../lib/supabase', () => ({
  supabase: { functions: { invoke: vi.fn() } },
}))

const DATA = {
  month: '2026-02',
  totals: {
    revenue: 455, cash: 160, card: 295, refunds: 0, netRevenue: 455, transactionCount: 61,
    wastage: 12, staffDrinks: 8, cashback: 0, prizeWins: 0, variance: -2, closedDayCount: 3,
  },
  outstandingTabs: 41.5,
  daily: [
    { date: '2026-02-01', cash: 100, card: 200, total: 300, refunds: 0, openingFloat: 320, actualCash: 418, variance: -2 },
  ],
  topProducts: [],
}

let click

beforeEach(() => {
  vi.clearAllMocks()
  fetchMonthlyReportData.mockResolvedValue(DATA)
  supabase.functions.invoke.mockResolvedValue({ error: null })
  // jsdom has no object URLs
  URL.createObjectURL = vi.fn(() => 'blob:monthly')
  URL.revokeObjectURL = vi.fn()
  click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})

afterEach(() => {
  click.mockRestore()
  delete URL.createObjectURL
  delete URL.revokeObjectURL
})

async function loadReport() {
  render(<MonthlyReportPage />)
  fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2026-02' } })
  fireEvent.click(screen.getByRole('button', { name: 'Load report' }))
  await screen.findByText('Outstanding tabs')
}

describe('MonthlyReportPage — audit events', () => {
  it('logs nothing until a report is actually loaded', () => {
    render(<MonthlyReportPage />)
    expect(logEvent).not.toHaveBeenCalled()
  })

  it('logs report.viewed with the month once the report is on screen', async () => {
    await loadReport()
    expect(fetchMonthlyReportData).toHaveBeenCalledWith('2026-02')
    expect(logEvent.mock.calls).toEqual([
      ['report.viewed', { report: 'monthly', month: '2026-02' }],
    ])
  })

  it('logs nothing when the report fails to load', async () => {
    fetchMonthlyReportData.mockRejectedValue(new Error('DB error'))
    render(<MonthlyReportPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Load report' }))
    await screen.findByText(/DB error/)
    expect(logEvent).not.toHaveBeenCalled()
  })

  it('logs report.exported when the CSV is downloaded', async () => {
    await loadReport()
    logEvent.mockClear()
    fireEvent.click(screen.getByRole('button', { name: /download csv/i }))
    expect(click).toHaveBeenCalledOnce()
    expect(logEvent.mock.calls).toEqual([
      ['report.exported', { report: 'monthly', month: '2026-02', rows: 3 }, { severity: 1 }],
    ])
  })

  it('logs report.emailed once the email has been sent', async () => {
    await loadReport()
    logEvent.mockClear()
    fireEvent.click(screen.getByRole('button', { name: /email to accountant/i }))
    await waitFor(() => expect(logEvent).toHaveBeenCalled())
    expect(supabase.functions.invoke).toHaveBeenCalledWith('send-monthly-report', {
      body: { csv: expect.any(String), month: '2026-02' },
    })
    expect(logEvent.mock.calls).toEqual([
      ['report.emailed', { report: 'monthly', month: '2026-02' }, { severity: 1 }],
    ])
  })

  it('logs the failure, not an email, when sending fails', async () => {
    await loadReport()
    logEvent.mockClear()
    supabase.functions.invoke.mockResolvedValue({ error: new Error('Resend is down') })
    fireEvent.click(screen.getByRole('button', { name: /email to accountant/i }))
    await waitFor(() => expect(logEvent).toHaveBeenCalled())
    expect(logEvent.mock.calls).toEqual([
      ['report.email_failed', { report: 'monthly', month: '2026-02', message: 'Resend is down' }, { severity: 1 }],
    ])
  })
})
