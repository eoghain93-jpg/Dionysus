import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import ZReportModal from './ZReportModal'

// Mock fetchZReportData
vi.mock('../../lib/zReport', () => ({
  fetchZReportData: vi.fn(),
}))

// Mock supabase (for Close Day insert and edge function call)
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      upsert: vi.fn().mockResolvedValue({ error: null }),
    })),
    functions: {
      invoke: vi.fn().mockResolvedValue({ error: null }),
    },
  },
}))

// Mock sessionStore — `session.activeStaff` is whoever is signed in
const { session, clearSession, callOrder } = vi.hoisted(() => {
  const callOrder = []
  return {
    callOrder,
    session: { activeStaff: null },
    clearSession: vi.fn(() => { callOrder.push('clearSession') }),
  }
})
vi.mock('../../stores/sessionStore', () => ({
  useSessionStore: {
    getState: vi.fn(() => ({ activeStaff: session.activeStaff, clearSession })),
  },
}))

// Audit plumbing: never the real queue, sign-out or seal store in a component test
vi.mock('../../lib/audit/log', () => ({ logEvent: vi.fn() }))
vi.mock('../../lib/audit/staff', () => ({ signOutStaff: vi.fn() }))
vi.mock('../../lib/audit/seal', () => ({ rememberedSeal: vi.fn() }))

import { fetchZReportData } from '../../lib/zReport'
import { supabase } from '../../lib/supabase'
import { logEvent } from '../../lib/audit/log'
import { signOutStaff } from '../../lib/audit/staff'
import { rememberedSeal } from '../../lib/audit/seal'

const eventsOfType = type => logEvent.mock.calls.filter(c => c[0] === type)

const REPORT_DATA = {
  salesSummary: {
    totalRevenue: 450.00,
    transactionCount: 38,
    cashTotal: 120.00,
    cashTotalByTill: { 'till-1': 120.00, 'till-2': 0 },
    cardTotal: 280.00,
    cardTotalByTill: { 'till-1': 280.00, 'till-2': 0 },
    refundsTotal: 15.00,
    netRevenue: 435.00,
  },
  cashbackTotal: 0,
  cashbackByTill: { 'till-1': 0, 'till-2': 0 },
  prizeWins: { total: 0, machine1: 0, machine2: 0, byTill: { 'till-1': 0, 'till-2': 0 } },
  topProducts: [
    { name: 'Guinness', qty: 42, revenue: 168.00 },
    { name: 'Lager',    qty: 30, revenue: 90.00 },
  ],
  wastage: [{ name: 'Guinness', quantity: 4, value: 29.60 }],
  staffDrinks: [{ name: 'Dave', items: 2, value: 13.40 }],
}

const DATE = '2026-03-30'

beforeEach(() => {
  vi.clearAllMocks()
  fetchZReportData.mockResolvedValue(REPORT_DATA)
  // Earlier tests swap these implementations; start each test from a clean,
  // succeeding close-day path.
  supabase.from.mockImplementation(() => ({ upsert: vi.fn().mockResolvedValue({ error: null }) }))
  supabase.functions.invoke.mockReset()
  supabase.functions.invoke.mockResolvedValue({ error: null })
  session.activeStaff = null
  callOrder.length = 0
  rememberedSeal.mockReturnValue(null)
  signOutStaff.mockImplementation(async () => { callOrder.push('signOutStaff') })
})

// ---- Loading state ----

describe('ZReportModal — loading', () => {
  it('shows loading indicator while fetching', () => {
    fetchZReportData.mockReturnValue(new Promise(() => {})) // never resolves
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })
})

// ---- Error state ----

describe('ZReportModal — error', () => {
  it('shows error message when fetch fails', async () => {
    fetchZReportData.mockRejectedValue(new Error('DB error'))
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText(/DB error/i)).toBeInTheDocument()
    })
  })
})

// ---- Sales Summary section ----

describe('ZReportModal — Sales Summary', () => {
  it('displays total revenue', async () => {
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByTestId('z-total-revenue')).toHaveTextContent('£450.00')
    })
  })

  it('displays transaction count', async () => {
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByTestId('z-transaction-count')).toHaveTextContent('38')
    })
  })

  it('displays cash total', async () => {
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByTestId('z-cash-total')).toHaveTextContent('£120.00')
    })
  })

  it('displays card total', async () => {
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByTestId('z-card-total')).toHaveTextContent('£280.00')
    })
  })

  it('does not display a tab total (tabs are IOUs, excluded from cash-basis revenue)', async () => {
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByTestId('z-total-revenue')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('z-tab-total')).not.toBeInTheDocument()
  })

  it('displays refunds total as negative', async () => {
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByTestId('z-refunds-total')).toHaveTextContent('-£15.00')
    })
  })

  it('displays net revenue', async () => {
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByTestId('z-net-revenue')).toHaveTextContent('£435.00')
    })
  })
})

// ---- Top Products section ----

describe('ZReportModal — Top Products', () => {
  it('renders each product name', async () => {
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText('Guinness')).toBeInTheDocument()
      expect(screen.getByText('Lager')).toBeInTheDocument()
    })
  })

  it('renders each product quantity', async () => {
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByTestId('z-product-qty-0')).toHaveTextContent('42')
      expect(screen.getByTestId('z-product-qty-1')).toHaveTextContent('30')
    })
  })

  it('renders each product revenue', async () => {
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByTestId('z-product-revenue-0')).toHaveTextContent('£168.00')
    })
  })

  it('shows empty state when no products', async () => {
    fetchZReportData.mockResolvedValue({ ...REPORT_DATA, topProducts: [] })
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText(/no product sales/i)).toBeInTheDocument()
    })
  })
})

// ---- Cash Reconciliation section ----

describe('ZReportModal — Cash Reconciliation', () => {
  it('renders till 1 opening float input defaulting to 200', async () => {
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByLabelText(/opening float till 1/i)).toHaveValue(200)
    })
  })

  it('renders till 1 actual cash input defaulting to 0', async () => {
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByLabelText(/actual cash till 1/i)).toHaveValue(0)
    })
  })

  it('combined expected = till1 (float + cash) + till2 (float + cash)', async () => {
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => {
      // till1: float 200 + cash 120 = 320. till2: float 120 + cash 0 = 120. Combined = 440
      expect(screen.getByTestId('z-expected-till')).toHaveTextContent('£440.00')
    })
    fireEvent.change(screen.getByLabelText(/opening float till 1/i), { target: { value: '50' } })
    // till1: 50 + 120 = 170. till2: 120 + 0 = 120. Combined = 290
    expect(screen.getByTestId('z-expected-till')).toHaveTextContent('£290.00')
  })

  it('combined variance = sum of per-till variances', async () => {
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByTestId('z-variance')).toBeInTheDocument()
    })
    // till1 expected = 320, set till1 actual = 315 → variance -5
    // till2 expected = 120, set till2 actual = 120 → variance 0
    // combined variance = -5
    fireEvent.change(screen.getByLabelText(/actual cash till 1/i), { target: { value: '315' } })
    fireEvent.change(screen.getByLabelText(/actual cash till 2/i), { target: { value: '120' } })
    expect(screen.getByTestId('z-variance')).toHaveTextContent('-£5.00')
  })

  it('variance has green styling when >= 0', async () => {
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => screen.getByTestId('z-variance'))
    fireEvent.change(screen.getByLabelText(/actual cash till 1/i), { target: { value: '320' } })
    fireEvent.change(screen.getByLabelText(/actual cash till 2/i), { target: { value: '120' } })
    expect(screen.getByTestId('z-variance')).toHaveClass('text-green-400')
  })

  it('variance has red styling when < 0', async () => {
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => screen.getByTestId('z-variance'))
    fireEvent.change(screen.getByLabelText(/actual cash till 1/i), { target: { value: '300' } })
    fireEvent.change(screen.getByLabelText(/actual cash till 2/i), { target: { value: '120' } })
    expect(screen.getByTestId('z-variance')).toHaveClass('text-red-400')
  })
})

// ---- Close button ----

describe('ZReportModal — Close (X) button', () => {
  it('calls onClose when X button clicked', async () => {
    const onClose = vi.fn()
    render(<ZReportModal date={DATE} onClose={onClose} onDayClose={vi.fn()} />)
    await waitFor(() => screen.getByTestId('z-total-revenue'))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})

// ---- Export CSV ----

describe('ZReportModal — Export CSV', () => {
  it('Export CSV button is present after data loads', async () => {
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /export csv/i })).toBeInTheDocument()
    })
  })
})

// ---- Close Day ----

describe('ZReportModal — Close Day', () => {
  it('Close Day button is present after data loads', async () => {
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /close day/i })).toBeInTheDocument()
    })
  })

  it('Close Day upserts into z_reports with correct date and floats', async () => {
    const { supabase } = await import('../../lib/supabase')
    const upsertMock = vi.fn().mockResolvedValue({ error: null })
    supabase.from.mockReturnValue({ upsert: upsertMock })

    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => screen.getByRole('button', { name: /close day/i }))

    // Set till 1 float to 50, till 2 float to 0 (no second till today), till 1 actual to 165
    fireEvent.change(screen.getByLabelText(/opening float till 1/i), { target: { value: '50' } })
    fireEvent.change(screen.getByLabelText(/opening float till 2/i), { target: { value: '0' } })
    fireEvent.change(screen.getByLabelText(/actual cash till 1/i), { target: { value: '165' } })
    fireEvent.change(screen.getByLabelText(/actual cash till 2/i), { target: { value: '0' } })

    fireEvent.click(screen.getByRole('button', { name: /close day/i }))

    await waitFor(() => {
      expect(supabase.from).toHaveBeenCalledWith('z_reports')
      expect(upsertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          report_date: DATE,
          opening_float: 50,
          actual_cash: 165,
        }),
        expect.objectContaining({ onConflict: 'report_date' })
      )
    })
  })

  it('Close Day invokes send-z-report edge function', async () => {
    const { supabase } = await import('../../lib/supabase')
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => screen.getByRole('button', { name: /close day/i }))
    fireEvent.click(screen.getByRole('button', { name: /close day/i }))

    await waitFor(() => {
      expect(supabase.functions.invoke).toHaveBeenCalledWith(
        'send-z-report',
        expect.objectContaining({ body: expect.objectContaining({ reportDate: DATE }) })
      )
    })
  })

  it('Close Day calls onDayClose after success', async () => {
    const onDayClose = vi.fn()
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={onDayClose} />)
    await waitFor(() => screen.getByRole('button', { name: /close day/i }))
    fireEvent.click(screen.getByRole('button', { name: /close day/i }))
    await waitFor(() => {
      expect(onDayClose).toHaveBeenCalledOnce()
    })
  })

  it('Close Day shows error when upsert fails', async () => {
    const { supabase } = await import('../../lib/supabase')
    supabase.from.mockReturnValue({
      upsert: vi.fn().mockResolvedValue({ error: { message: 'Insert failed' } }),
    })
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => screen.getByRole('button', { name: /close day/i }))
    fireEvent.click(screen.getByRole('button', { name: /close day/i }))
    await waitFor(() => {
      expect(screen.getByText(/insert failed/i)).toBeInTheDocument()
    })
  })
})

// ---- Audit: who closed the day, and the log's outside witness ----

async function renderAndCloseDay(props = {}) {
  const onDayClose = vi.fn()
  render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={onDayClose} {...props} />)
  await waitFor(() => screen.getByRole('button', { name: /close day/i }))
  // async act: the close-day promise chain settles inside React's act scope
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /close day/i })) })
  return { onDayClose }
}

const emailedDates = () =>
  supabase.functions.invoke.mock.calls.map(([name, opts]) => `${name}|${opts.body.reportDate}`)

describe('ZReportModal — Close Day attribution', () => {
  it('sends closed_by: the signed-in staff member', async () => {
    session.activeStaff = { id: 'staff-7', name: 'Dave' }
    const upsertMock = vi.fn().mockResolvedValue({ error: null })
    supabase.from.mockReturnValue({ upsert: upsertMock })
    const { onDayClose } = await renderAndCloseDay()
    await waitFor(() => expect(onDayClose).toHaveBeenCalledOnce())
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ report_date: DATE, closed_by: 'staff-7' }),
      expect.objectContaining({ onConflict: 'report_date' }),
    )
  })

  it('sends closed_by: null when nobody is signed in', async () => {
    const upsertMock = vi.fn().mockResolvedValue({ error: null })
    supabase.from.mockReturnValue({ upsert: upsertMock })
    const { onDayClose } = await renderAndCloseDay()
    await waitFor(() => expect(onDayClose).toHaveBeenCalledOnce())
    expect(upsertMock.mock.calls[0][0]).toHaveProperty('closed_by', null)
  })

  it('ends the staff session on the server (reason close_day) BEFORE clearing it on the till', async () => {
    const { onDayClose } = await renderAndCloseDay()
    await waitFor(() => expect(onDayClose).toHaveBeenCalledOnce())
    expect(signOutStaff).toHaveBeenCalledWith('close_day')
    expect(callOrder).toEqual(['signOutStaff', 'clearSession'])
  })

  it('still locks the till and finishes when the server sign-out rejects', async () => {
    signOutStaff.mockRejectedValue(new Error('offline'))
    const { onDayClose } = await renderAndCloseDay()
    await waitFor(() => expect(onDayClose).toHaveBeenCalledOnce())
    expect(clearSession).toHaveBeenCalledOnce()
    expect(screen.queryByText(/offline/i)).not.toBeInTheDocument()
  })

  it('still locks the till when the server sign-out throws outright', async () => {
    signOutStaff.mockImplementation(() => { throw new Error('boom') })
    const { onDayClose } = await renderAndCloseDay()
    await waitFor(() => expect(onDayClose).toHaveBeenCalledOnce())
    expect(clearSession).toHaveBeenCalledOnce()
  })

  it('does not wait for a sign-out that never answers', async () => {
    signOutStaff.mockReturnValue(new Promise(() => {}))
    const { onDayClose } = await renderAndCloseDay()
    await waitFor(() => expect(onDayClose).toHaveBeenCalledOnce(), { timeout: 4000 })
    expect(clearSession).toHaveBeenCalledOnce()
  })

  it('does not sign anyone out when the upsert fails', async () => {
    supabase.from.mockReturnValue({
      upsert: vi.fn().mockResolvedValue({ error: { message: 'Insert failed' } }),
    })
    await renderAndCloseDay()
    await waitFor(() => expect(screen.getByText(/insert failed/i)).toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole('button', { name: /close day/i })).toBeEnabled())
    expect(signOutStaff).not.toHaveBeenCalled()
    expect(clearSession).not.toHaveBeenCalled()
    expect(supabase.functions.invoke).not.toHaveBeenCalled()
  })
})

describe('ZReportModal — log seal in the Z-report email', () => {
  const SEAL = { id: 41, hash: 'abc123', code: 'K7QM-2F9D', at: '2026-03-30T22:55:00Z' }

  it('with no remembered seal: one send, plain date (exactly as before)', async () => {
    const { onDayClose } = await renderAndCloseDay()
    await waitFor(() => expect(onDayClose).toHaveBeenCalledOnce())
    expect(emailedDates()).toEqual([`send-z-report|${DATE}`])
  })

  it('with a remembered seal: the subject date carries the seal code', async () => {
    rememberedSeal.mockReturnValue(SEAL)
    const { onDayClose } = await renderAndCloseDay()
    await waitFor(() => expect(onDayClose).toHaveBeenCalledOnce())
    expect(emailedDates()).toEqual([`send-z-report|${DATE} · log seal K7QM-2F9D`])
    expect(eventsOfType('report.emailed')).toEqual([
      ['report.emailed', { report: 'z_report', date: DATE, seal: 'K7QM-2F9D' }, { severity: 1 }],
    ])
  })

  it('the decorated string goes ONLY to the email: the saved report_date stays the plain date', async () => {
    rememberedSeal.mockReturnValue(SEAL)
    const upsertMock = vi.fn().mockResolvedValue({ error: null })
    supabase.from.mockReturnValue({ upsert: upsertMock })
    const { onDayClose } = await renderAndCloseDay()
    await waitFor(() => expect(onDayClose).toHaveBeenCalledOnce())
    expect(upsertMock.mock.calls[0][0].report_date).toBe(DATE)
    expect(eventsOfType('day.closed')[0][1].date).toBe(DATE)
    // Everything else in the email body is identical to an unsealed send
    const body = supabase.functions.invoke.mock.calls[0][1].body
    expect(body.salesSummary).toEqual(REPORT_DATA.salesSummary)
    expect(body.topProducts).toEqual(REPORT_DATA.topProducts)
  })

  it('retries ONCE with the plain date when the sealed send returns an error', async () => {
    rememberedSeal.mockReturnValue(SEAL)
    supabase.functions.invoke
      .mockResolvedValueOnce({ error: { message: 'subject rejected' } })
      .mockResolvedValueOnce({ error: null })
    const { onDayClose } = await renderAndCloseDay()
    await waitFor(() => expect(onDayClose).toHaveBeenCalledOnce())
    expect(emailedDates()).toEqual([
      `send-z-report|${DATE} · log seal K7QM-2F9D`,
      `send-z-report|${DATE}`,
    ])
    expect(screen.queryByText(/subject rejected/i)).not.toBeInTheDocument()
    expect(clearSession).toHaveBeenCalledOnce()
    // The log says the seal did not make it into the email
    expect(eventsOfType('report.emailed')[0][1]).toEqual({ report: 'z_report', date: DATE, seal: null })
  })

  it('retries with the plain date when the sealed send throws', async () => {
    rememberedSeal.mockReturnValue(SEAL)
    supabase.functions.invoke
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ error: null })
    const { onDayClose } = await renderAndCloseDay()
    await waitFor(() => expect(onDayClose).toHaveBeenCalledOnce())
    expect(supabase.functions.invoke).toHaveBeenCalledTimes(2)
    expect(supabase.functions.invoke.mock.calls[1][1].body.reportDate).toBe(DATE)
  })

  it('when the plain retry fails too: shows the error, does not lock the till, sends no third time', async () => {
    rememberedSeal.mockReturnValue(SEAL)
    supabase.functions.invoke.mockResolvedValue({ error: { message: 'Resend is down' } })
    const { onDayClose } = await renderAndCloseDay()
    await waitFor(() => expect(screen.getByText(/resend is down/i)).toBeInTheDocument())
    expect(supabase.functions.invoke).toHaveBeenCalledTimes(2)
    expect(onDayClose).not.toHaveBeenCalled()
    expect(clearSession).not.toHaveBeenCalled()
    expect(signOutStaff).not.toHaveBeenCalled()
    expect(eventsOfType('report.emailed')).toEqual([])
    expect(eventsOfType('report.email_failed')).toEqual([
      ['report.email_failed', { report: 'z_report', date: DATE, message: 'Resend is down' }, { severity: 1 }],
    ])
  })

  it('with no seal a failed send is NOT retried (unchanged behaviour)', async () => {
    supabase.functions.invoke.mockResolvedValue({ error: { message: 'Resend is down' } })
    const { onDayClose } = await renderAndCloseDay()
    await waitFor(() => expect(screen.getByText(/resend is down/i)).toBeInTheDocument())
    expect(supabase.functions.invoke).toHaveBeenCalledTimes(1)
    expect(onDayClose).not.toHaveBeenCalled()
  })

  it('a remembered seal with no code sends the plain date', async () => {
    rememberedSeal.mockReturnValue({ id: 41, hash: 'abc123' })
    const { onDayClose } = await renderAndCloseDay()
    await waitFor(() => expect(onDayClose).toHaveBeenCalledOnce())
    expect(emailedDates()).toEqual([`send-z-report|${DATE}`])
  })

  it('a seal store that throws cannot stop the report going out', async () => {
    rememberedSeal.mockImplementation(() => { throw new Error('storage blocked') })
    const { onDayClose } = await renderAndCloseDay()
    await waitFor(() => expect(onDayClose).toHaveBeenCalledOnce())
    expect(emailedDates()).toEqual([`send-z-report|${DATE}`])
  })
})

describe('ZReportModal — audit events', () => {
  it('logs report.viewed once the figures are on screen', async () => {
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => screen.getByTestId('z-total-revenue'))
    expect(eventsOfType('report.viewed')).toEqual([
      ['report.viewed', { report: 'z_report', date: DATE }],
    ])
  })

  it('logs nothing when the report fails to load', async () => {
    fetchZReportData.mockRejectedValue(new Error('DB error'))
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => screen.getByText(/DB error/i))
    expect(logEvent).not.toHaveBeenCalled()
  })

  it('logs report.exported when the CSV is downloaded', async () => {
    // jsdom has no object URLs
    URL.createObjectURL = vi.fn(() => 'blob:z')
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    try {
      render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
      await waitFor(() => screen.getByRole('button', { name: /export csv/i }))
      fireEvent.click(screen.getByRole('button', { name: /export csv/i }))
      await waitFor(() => expect(click).toHaveBeenCalledOnce())
      const [[, detail, opts]] = eventsOfType('report.exported')
      expect(detail).toMatchObject({ report: 'z_report', date: DATE })
      expect(detail.rows).toBeGreaterThan(0)
      expect(opts).toEqual({ severity: 1 })
    } finally {
      click.mockRestore()
      delete URL.createObjectURL
      delete URL.revokeObjectURL
    }
  })

  it('logs day.closed with the combined and per-till figures as typed', async () => {
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => screen.getByRole('button', { name: /close day/i }))
    // till 1: float 200 + cash 120 = 320 expected, 315 counted → -5
    // till 2: float 120 + cash 0   = 120 expected, 120 counted →  0
    fireEvent.change(screen.getByLabelText(/actual cash till 1/i), { target: { value: '315' } })
    fireEvent.change(screen.getByLabelText(/actual cash till 2/i), { target: { value: '120' } })
    fireEvent.click(screen.getByRole('button', { name: /close day/i }))
    await waitFor(() => expect(eventsOfType('day.closed')).toHaveLength(1))
    expect(eventsOfType('day.closed')[0]).toEqual(['day.closed', {
      date: DATE,
      opening_float: 320,
      actual_cash: 435,
      expected_cash: 440,
      variance: -5,
      tills: {
        'till-1': { opening_float: 200, expected_cash: 320, actual_cash: 315, variance: -5 },
        'till-2': { opening_float: 120, expected_cash: 120, actual_cash: 120, variance: 0 },
      },
    }, { severity: 1 }])
  })

  it('logs no day.closed when the upsert fails', async () => {
    supabase.from.mockReturnValue({
      upsert: vi.fn().mockResolvedValue({ error: { message: 'Insert failed' } }),
    })
    await renderAndCloseDay()
    await waitFor(() => expect(screen.getByText(/insert failed/i)).toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole('button', { name: /close day/i })).toBeEnabled())
    expect(eventsOfType('day.closed')).toEqual([])
    expect(eventsOfType('report.emailed')).toEqual([])
    expect(eventsOfType('report.email_failed')).toEqual([])
  })

  it('never puts a seal hash or a staff record in an event', async () => {
    session.activeStaff = { id: 'staff-7', name: 'Dave', pin_hash: 'SECRET-HASH' }
    rememberedSeal.mockReturnValue({ id: 41, hash: 'SEAL-HASH', code: 'K7QM-2F9D' })
    const { onDayClose } = await renderAndCloseDay()
    await waitFor(() => expect(onDayClose).toHaveBeenCalledOnce())
    const everything = JSON.stringify(logEvent.mock.calls)
    expect(everything).not.toContain('SECRET-HASH')
    expect(everything).not.toContain('SEAL-HASH')
  })
})

describe('ZReportModal — Wastage & Staff Drinks', () => {
  it('shows wastage section heading', async () => {
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText(/wastage/i)).toBeInTheDocument()
    })
  })

  it('shows wastage product and value', async () => {
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText('Guinness')).toBeInTheDocument()
      expect(screen.getByText('£29.60')).toBeInTheDocument()
    })
  })

  it('shows staff drinks section heading', async () => {
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText(/staff drinks/i)).toBeInTheDocument()
    })
  })

  it('shows staff member and value', async () => {
    render(<ZReportModal date={DATE} onClose={vi.fn()} onDayClose={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText('Dave')).toBeInTheDocument()
      expect(screen.getByText(/2 items/i)).toBeInTheDocument()
      expect(screen.getByText('£13.40')).toBeInTheDocument()
    })
  })
})
