import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import StocktakePage from './StocktakePage'
import { fetchStocktakeData } from '../lib/stocktake'
import { supabase } from '../lib/supabase'
import { logEvent } from '../lib/audit/log'

vi.mock('../lib/audit/log', () => ({ logEvent: vi.fn() }))
vi.mock('../lib/stocktake', () => ({
  fetchStocktakeData: vi.fn(),
  toCsv: vi.fn(() => 'Product,Sold\nGuinness,42\nLager,30'),
}))
vi.mock('../lib/supabase', () => ({
  supabase: { functions: { invoke: vi.fn() } },
}))
vi.mock('../lib/tradingDay', () => ({
  tradingTodayISO: () => '2026-03-30',
  addDaysISO: () => '2026-02-28',
}))

const DATA = {
  startDate: '2026-02-28',
  endDate: '2026-03-30',
  totals: { salesRevenue: 258, wastageValue: 29.6, staffDrinkValue: 13.4 },
  rows: [
    { product_id: 'p1', name: 'Guinness', category: 'draught', unit: 'pint', soldQty: 42, soldRevenue: 168, wastageQty: 4, staffDrinkQty: 2, totalOut: 48, systemStock: 100 },
    { product_id: 'p2', name: 'Lager', category: 'draught', unit: 'pint', soldQty: 30, soldRevenue: 90, wastageQty: 0, staffDrinkQty: 0, totalOut: 30, systemStock: 80 },
  ],
}

let click

beforeEach(() => {
  vi.clearAllMocks()
  fetchStocktakeData.mockResolvedValue(DATA)
  supabase.functions.invoke.mockResolvedValue({ error: null })
  // jsdom has no object URLs
  URL.createObjectURL = vi.fn(() => 'blob:stocktake')
  URL.revokeObjectURL = vi.fn()
  click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})

afterEach(() => {
  click.mockRestore()
  delete URL.createObjectURL
  delete URL.revokeObjectURL
})

async function loadReport() {
  render(<StocktakePage />)
  fireEvent.click(screen.getByRole('button', { name: 'Load report' }))
  await screen.findByText('Guinness')
}

describe('StocktakePage — audit events', () => {
  it('logs nothing until a report is actually loaded', () => {
    render(<StocktakePage />)
    expect(logEvent).not.toHaveBeenCalled()
  })

  it('logs report.viewed with the range once the report is on screen', async () => {
    await loadReport()
    expect(fetchStocktakeData).toHaveBeenCalledWith('2026-02-28', '2026-03-30')
    expect(logEvent.mock.calls).toEqual([
      ['report.viewed', { report: 'stocktake', from: '2026-02-28', to: '2026-03-30' }],
    ])
  })

  it('logs nothing when the report fails to load', async () => {
    fetchStocktakeData.mockRejectedValue(new Error('DB error'))
    render(<StocktakePage />)
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
      ['report.exported', { report: 'stocktake', from: '2026-02-28', to: '2026-03-30', rows: 2 }, { severity: 1 }],
    ])
  })

  it('logs report.emailed once the email has been sent', async () => {
    await loadReport()
    logEvent.mockClear()
    let finish
    supabase.functions.invoke.mockReturnValue(new Promise(resolve => { finish = resolve }))
    fireEvent.click(screen.getByRole('button', { name: /email to manager/i }))
    await waitFor(() => expect(supabase.functions.invoke).toHaveBeenCalledWith('send-stocktake', {
      body: { csv: 'Product,Sold\nGuinness,42\nLager,30', startDate: '2026-02-28', endDate: '2026-03-30' },
    }))
    // not on the button press — only once it has gone
    expect(logEvent).not.toHaveBeenCalled()
    finish({ error: null })
    await waitFor(() => expect(logEvent).toHaveBeenCalled())
    expect(logEvent.mock.calls).toEqual([
      ['report.emailed', { report: 'stocktake', from: '2026-02-28', to: '2026-03-30' }, { severity: 1 }],
    ])
  })

  it('logs the failure, not an email, when sending fails', async () => {
    await loadReport()
    logEvent.mockClear()
    supabase.functions.invoke.mockResolvedValue({ error: new Error('Resend is down') })
    fireEvent.click(screen.getByRole('button', { name: /email to manager/i }))
    await waitFor(() => expect(logEvent).toHaveBeenCalled())
    expect(logEvent.mock.calls).toEqual([
      ['report.email_failed', {
        report: 'stocktake', from: '2026-02-28', to: '2026-03-30', message: 'Resend is down',
      }, { severity: 1 }],
    ])
  })
})
