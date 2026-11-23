import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import AuditPage from './AuditPage'
import {
  fetchAuditEntries, fetchAuditHealth, fetchAuditNames, fetchAuditSessions, markAuditChecked, verifyAuditNow,
} from '../lib/audit/view'
import { rememberedSeal } from '../lib/audit/seal'
import { setAuditHeadersEnabled } from '../lib/audit/fetch'
import { setStaffSession, clearStaffSession } from '../lib/audit/staffSession'
import { findView, rangeToIso } from '../components/audit/quickViews'

// The page talks to the database only through view.js.
vi.mock('../lib/audit/view', () => ({
  AUDIT_ERROR: {
    NOT_AVAILABLE: 'not_available',
    NOT_SIGNED_IN: 'not_signed_in',
    NOT_ALLOWED: 'not_allowed',
    OFFLINE: 'offline',
    FAILED: 'failed',
  },
  fetchAuditEntries: vi.fn(),
  fetchAuditHealth: vi.fn(),
  fetchAuditNames: vi.fn(),
  fetchAuditSessions: vi.fn(),
  markAuditChecked: vi.fn(),
  verifyAuditNow: vi.fn(),
}))
vi.mock('../lib/audit/seal', () => ({ rememberedSeal: vi.fn(() => null) }))

const SAM = '5a000000-0000-0000-0000-000000000001'
const KIM = '5a000000-0000-0000-0000-000000000002'
const MO = 'a0000000-0000-0000-0000-000000000003'
const GUINNESS = 'b0000000-0000-0000-0000-000000000001'
const CRISPS = 'b0000000-0000-0000-0000-000000000002'
const ORDER1 = 'c0000000-0000-0000-0000-000000000001'

// "Now" for every test: Sunday 22 November 2026, 14:00 on the till's clock.
const NOW = new Date(2026, 10, 22, 14, 0, 0)
const at = (hour, minute = 0, daysAgo = 0) => new Date(2026, 10, 22 - daysAgo, hour, minute, 0).toISOString()
const RANGE = rangeToIso({ from: '2026-11-21', to: '2026-11-22' })

const errorOf = (kind, message) => Object.assign(new Error(message), { kind })

const base = {
  severity: 0, table: null, pk: null, subject: null, old: null, new: null, changed: null, detail: null,
  actor: 'till', till_id: 'till-1', staff_id: SAM, staff_name: 'Sam Staff', staff_trust: 'pin',
  via: 'PATCH /products', ip: '203.0.113.10', app_build: 'test123', client_at: null, sealed: true, checked: false,
}

const priceChange = (seq = 120, extra = {}) => ({
  ...base, seq, at: at(13, 2), kind: 'row', action: 'update', table: 'products', pk: GUINNESS, subject: 'Guinness', severity: 2,
  changed: ['standard_price'], old: { standard_price: 7.4 }, new: { standard_price: 6.4 },
  detail: { flags: ['price_changed', 'member_discount_removed'] }, ...extra,
})
const blockedDelete = (seq = 119, extra = {}) => ({
  ...base, seq, at: at(12, 30), kind: 'guard', action: 'blocked.delete', table: 'orders', pk: ORDER1, severity: 3,
  via: 'DELETE /orders', old: { id: ORDER1, payment_method: 'cash', total_amount: 7.4, status: 'paid' },
  detail: { rule: 'no_delete', flags: ['history_rewrite_attempt'] }, ...extra,
})
const drawerOpened = (seq = 118, extra = {}) => ({
  ...base, seq, at: at(21, 15, 1), kind: 'event', action: 'drawer.opened_no_sale', severity: 2, staff_id: null, staff_name: null, staff_trust: 'none',
  via: 'POST /rpc/audit_log_events', client_at: at(21, 15, 1), detail: { source: 'settings', till: 'till-1', page: '/settings' }, ...extra,
})
const sale = (seq = 110, extra = {}) => ({
  ...base, seq, at: at(11, 0), kind: 'row', action: 'insert', table: 'orders', pk: ORDER1, via: 'POST /rpc/create_order_with_items',
  new: { id: ORDER1, member_id: MO, staff_id: SAM, payment_method: 'tab', total_amount: 13.8, status: 'paid', till_id: 'till-1', created_at: at(11, 0) },
  detail: { rung_by_trust: 'pin' }, ...extra,
})
const saleLines = (seq = 111, extra = {}) => ({
  ...base, seq, at: at(11, 0), kind: 'row', action: 'insert', table: 'order_items', pk: ORDER1, via: 'POST /rpc/create_order_with_items',
  new: [
    { id: 'l1', product_id: GUINNESS, quantity: 2, unit_price: 6.4, member_price_applied: true },
    { id: 'l2', product_id: CRISPS, quantity: 1, unit_price: 1, member_price_applied: false },
  ],
  detail: { lines: { l1: { product: 'Guinness', list_standard: 7.4, list_member: 6.4 }, l2: { product: 'Crisps', list_standard: 1, list_member: 1 } }, rows: 2 },
  ...extra,
})

const healthy = (extra = {}) => ({
  entries: 12340, entries_24h: 310, last_entry_at: at(13, 58), unsealed: 2, oldest_unsealed_at: at(13, 58),
  seal: { id: 42, code: 'S42-4F2A-91BC', hash: 'aa'.repeat(32), sealed_at: at(13, 57) },
  last_check: { result: 'integrity.ok', at: at(5, 17) },
  unchecked_alerts: 3, capture_failures_7d: 0,
  coverage: { tables: 22, missing: [], disabled: [] },
  settings: { capture_enabled: true, guards_enforced: true, session_max_hours: 24 },
  bytes: 4.2 * 1024 * 1024, ...extra,
})

const page = (entries, next = null) => ({ entries, next_before_seq: next })

function renderPage(route = '/log') {
  return render(<MemoryRouter initialEntries={[route]}><AuditPage /></MemoryRouter>)
}

const lastFilters = () => fetchAuditEntries.mock.calls.at(-1)[0]

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.clearAllMocks()
  rememberedSeal.mockReturnValue(null)
  fetchAuditEntries.mockResolvedValue(page([]))
  fetchAuditHealth.mockResolvedValue(healthy())
  fetchAuditSessions.mockResolvedValue([])
  fetchAuditNames.mockResolvedValue({
    names: { [SAM]: 'Sam Staff', [KIM]: 'Kim Newstarter', [MO]: 'Mo Member', [GUINNESS]: 'Guinness', [CRISPS]: 'Crisps' },
    staff: [{ id: KIM, name: 'Kim Newstarter' }, { id: SAM, name: 'Sam Staff' }],
  })
  markAuditChecked.mockResolvedValue(true)
  verifyAuditNow.mockResolvedValue({ ok: true, seals_checked: 43, rows_checked: 12345, unsealed_rows: 0, problems: [], head: { id: 43, code: 'S43-AB12-CD34' } })
})

afterEach(() => {
  vi.useRealTimers()
  setAuditHeadersEnabled(false)
  clearStaffSession()
})

describe('AuditPage — needs a look (the default view)', () => {
  it('loads the alerts nobody has checked yet, newest first, in plain English', async () => {
    fetchAuditEntries.mockResolvedValue(page([priceChange(), blockedDelete(), drawerOpened()]))
    renderPage()

    expect(screen.getByText('Loading the log…')).toBeInTheDocument()
    expect(await screen.findByText('Changed Guinness standard price from £7.40 to £6.40')).toBeInTheDocument()
    expect(fetchAuditEntries).toHaveBeenCalledTimes(1)
    expect(fetchAuditEntries).toHaveBeenCalledWith([{ unchecked: true }], { limit: 100 })

    expect(screen.getByText('Blocked: an attempt to delete a sale of £7.40 by cash directly')).toBeInTheDocument()
    expect(screen.getByText('Cash drawer opened without a sale (from the Settings page)')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Mark as checked' })).toHaveLength(3)

    // grouped by day, newest first
    const days = screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent)
    expect(days).toEqual(['Today', 'Yesterday'])
    const titles = screen.getAllByRole('listitem').map(li => li.querySelector('p')?.textContent).filter(Boolean)
    expect(titles.slice(0, 3)).toEqual([
      'Changed Guinness standard price from £7.40 to £6.40',
      'Blocked: an attempt to delete a sale of £7.40 by cash directly',
      'Cash drawer opened without a sale (from the Settings page)',
    ])
  })

  it('shows who, how sure, which till, the severity and the reasons', async () => {
    fetchAuditEntries.mockResolvedValue(page([priceChange(), blockedDelete(), drawerOpened()]))
    renderPage()
    const card = (await screen.findByText('Changed Guinness standard price from £7.40 to £6.40')).closest('li')

    expect(within(card).getByText('Sam Staff')).toBeInTheDocument()
    expect(within(card).getByText('PIN checked')).toBeInTheDocument()
    expect(within(card).getByText('· Till 1')).toBeInTheDocument()
    expect(within(card).getByText('Needs a look')).toBeInTheDocument()
    expect(within(card).getByText('Price changed')).toBeInTheDocument()
    expect(within(card).getByText('Member discount removed')).toBeInTheDocument()
    expect(within(card).queryByText(/reported by the till/)).not.toBeInTheDocument()

    const serious = screen.getByText('Blocked: an attempt to delete a sale of £7.40 by cash directly').closest('li')
    expect(within(serious).getByText('Serious')).toBeInTheDocument()

    const reported = screen.getByText('Cash drawer opened without a sale (from the Settings page)').closest('li')
    expect(within(reported).getByText('Nobody signed in')).toBeInTheDocument()
    expect(within(reported).getByText(/reported by the till/)).toBeInTheDocument()
  })

  it('says "Nothing here" when there are no alerts', async () => {
    renderPage()
    expect(await screen.findByText('Nothing here')).toBeInTheDocument()
    expect(screen.getByText('No alerts are waiting to be checked.')).toBeInTheDocument()
  })

  it('marks an alert as checked and takes it off the list', async () => {
    fetchAuditEntries.mockResolvedValue(page([priceChange(120), blockedDelete(119)]))
    renderPage()
    const card = (await screen.findByText('Changed Guinness standard price from £7.40 to £6.40')).closest('li')
    expect(await screen.findByRole('button', { name: '3 alerts need a look' })).toBeInTheDocument()

    fireEvent.click(within(card).getByRole('button', { name: 'Mark as checked' }))

    await waitFor(() => expect(screen.queryByText('Changed Guinness standard price from £7.40 to £6.40')).not.toBeInTheDocument())
    expect(markAuditChecked).toHaveBeenCalledTimes(1)
    expect(markAuditChecked).toHaveBeenCalledWith(120, null)
    expect(screen.getByText('Blocked: an attempt to delete a sale of £7.40 by cash directly')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '2 alerts need a look' })).toBeInTheDocument()
    // no reload needed
    expect(fetchAuditEntries).toHaveBeenCalledTimes(1)
  })

  it('sends an optional note with the check', async () => {
    fetchAuditEntries.mockResolvedValue(page([priceChange(120)]))
    renderPage()
    const card = (await screen.findByText('Changed Guinness standard price from £7.40 to £6.40')).closest('li')

    fireEvent.click(within(card).getByRole('button', { name: 'Add a note first' }))
    fireEvent.change(within(card).getByLabelText('Note for this alert'), { target: { value: '  Sam corrected a typo  ' } })
    fireEvent.click(within(card).getByRole('button', { name: 'Mark as checked' }))

    await waitFor(() => expect(markAuditChecked).toHaveBeenCalledWith(120, 'Sam corrected a typo'))
    await waitFor(() => expect(screen.getByText('Nothing here')).toBeInTheDocument())
  })

  it('keeps the alert and says so when it could not be marked', async () => {
    markAuditChecked.mockRejectedValue(errorOf('failed', 'That entry could not be marked as checked'))
    fetchAuditEntries.mockResolvedValue(page([priceChange(120)]))
    renderPage()
    const card = (await screen.findByText('Changed Guinness standard price from £7.40 to £6.40')).closest('li')

    fireEvent.click(within(card).getByRole('button', { name: 'Mark as checked' }))

    expect(await within(card).findByRole('alert')).toHaveTextContent('That entry could not be marked as checked')
    expect(screen.getByText('Changed Guinness standard price from £7.40 to £6.40')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '3 alerts need a look' })).toBeInTheDocument()
  })

  it('in any other view a checked alert stays where it is and shows as checked', async () => {
    renderPage()
    await screen.findByText('Nothing here')
    fetchAuditEntries.mockResolvedValue(page([priceChange(120), sale(110)]))
    fireEvent.click(screen.getByRole('button', { name: 'Everything' }))
    const card = (await screen.findByText('Changed Guinness standard price from £7.40 to £6.40')).closest('li')

    fireEvent.click(within(card).getByRole('button', { name: 'Mark as checked' }))

    expect(await within(card).findByText('Checked')).toBeInTheDocument()
    expect(markAuditChecked).toHaveBeenCalledWith(120, null)
    expect(screen.getByText('Changed Guinness standard price from £7.40 to £6.40')).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'Mark as checked' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '2 alerts need a look' })).toBeInTheDocument()
  })

  it('checks both halves of a sale shown as one entry', async () => {
    const outside = { actor: 'database', till_id: null, staff_id: null, staff_name: null, staff_trust: 'none', via: 'sql:postgres/psql', severity: 2 }
    fetchAuditEntries.mockResolvedValue(page([
      saleLines(111, { ...outside, detail: { ...saleLines().detail, flags: ['outside_the_till'] } }),
      sale(110, { ...outside, detail: { flags: ['outside_the_till', 'no_staff_on_sale'] } }),
    ]))
    renderPage()
    const card = (await screen.findByText('Sale of £13.80 on tab: 2 × Guinness, 1 × Crisps')).closest('li')
    expect(within(card).getByText('Made outside the till')).toBeInTheDocument()

    fireEvent.click(within(card).getByRole('button', { name: 'Mark as checked' }))

    await waitFor(() => expect(screen.getByText('Nothing here')).toBeInTheDocument())
    expect(markAuditChecked.mock.calls).toEqual([[110, null], [111, null]])
    expect(screen.getByRole('button', { name: '1 alert needs a look' })).toBeInTheDocument()
  })

  it('offers no "Mark as checked" on routine entries or ones already checked', async () => {
    fetchAuditEntries.mockResolvedValue(page([priceChange(120, { checked: true }), sale(110)]))
    renderPage()
    const card = (await screen.findByText('Changed Guinness standard price from £7.40 to £6.40')).closest('li')
    expect(within(card).getByText('Checked')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mark as checked' })).not.toBeInTheDocument()
  })
})

describe('AuditPage — quick views and filters', () => {
  it('switching quick view changes the filter', async () => {
    renderPage()
    await screen.findByText('Nothing here')

    fireEvent.click(screen.getByRole('button', { name: 'Prices and products' }))

    await waitFor(() => expect(fetchAuditEntries).toHaveBeenCalledTimes(2))
    const expected = findView('prices').filters.map(f => ({ ...f, from: RANGE.from, to: RANGE.to }))
    expect(fetchAuditEntries).toHaveBeenLastCalledWith(expected, { limit: 100 })
    expect(lastFilters()[0].tables).toContain('products')
    expect(screen.getByRole('button', { name: 'Prices and products' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Needs a look' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('offers every quick view, as buttons and (for a phone) as a picker', async () => {
    renderPage()
    await screen.findByText('Nothing here')
    const labels = ['Needs a look', 'Everything', 'Prices and products', 'Sales and voids', 'Tabs and cash', 'Stock', 'Members and staff', 'Sign-ins', 'Till actions', 'Outside the till']
    const group = screen.getByRole('group', { name: 'Quick views' })
    expect(within(group).getAllByRole('button').map(b => b.textContent)).toEqual(labels)

    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'till' } })
    await waitFor(() => expect(lastFilters()).toEqual([{ kinds: ['event'], from: RANGE.from, to: RANGE.to }]))
  })

  it('"Everything" defaults to today and yesterday, and the dates can be changed', async () => {
    renderPage()
    await screen.findByText('Nothing here')
    // unchecked alerts are shown whatever their date
    expect(screen.queryByLabelText('From')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Everything' }))
    await waitFor(() => expect(lastFilters()).toEqual([{ from: RANGE.from, to: RANGE.to }]))
    expect(screen.getByLabelText('From')).toHaveValue('2026-11-21')
    expect(screen.getByLabelText('To')).toHaveValue('2026-11-22')

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-11-01' } })
    const wider = rangeToIso({ from: '2026-11-01', to: '2026-11-22' })
    await waitFor(() => expect(lastFilters()).toEqual([{ from: wider.from, to: wider.to }]))
  })

  it('filters by staff member and till', async () => {
    renderPage()
    await screen.findByText('Nothing here')
    await screen.findByRole('option', { name: 'Kim Newstarter' })

    fireEvent.change(screen.getByLabelText('Staff member'), { target: { value: KIM } })
    await waitFor(() => expect(lastFilters()).toEqual([{ unchecked: true, staff_id: KIM }]))

    fireEvent.change(screen.getByLabelText('Till'), { target: { value: 'till-1' } })
    await waitFor(() => expect(lastFilters()).toEqual([{ unchecked: true, staff_id: KIM, till_id: 'till-1' }]))
  })

  it('offers the tills and staff seen in recent sign-ins', async () => {
    fetchAuditSessions.mockResolvedValue([
      { id: 's1', staff_id: 'x1', staff_name: 'Old Hand', till_id: 'till-2', trust: 'pin', started_at: at(9), ended_at: null, end_reason: null, ip: null },
    ])
    renderPage()
    expect(await screen.findByRole('option', { name: 'Till 2' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Till 1' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Old Hand' })).toBeInTheDocument()
    expect(fetchAuditSessions).toHaveBeenCalledWith()
  })

  it('searches when the search is submitted, and clears with the box', async () => {
    renderPage()
    await screen.findByText('Nothing here')

    fireEvent.change(screen.getByLabelText('Search the log'), { target: { value: 'guinness' } })
    expect(fetchAuditEntries).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(lastFilters()).toEqual([{ unchecked: true, q: 'guinness' }]))
    expect(await screen.findByText('Nothing matches these dates and filters.')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Search the log'), { target: { value: '' } })
    await waitFor(() => expect(lastFilters()).toEqual([{ unchecked: true }]))
  })

  it('"Sign-ins" also shows who was signed in where and when', async () => {
    fetchAuditSessions.mockResolvedValue([
      { id: 's2', staff_id: KIM, staff_name: 'Kim Newstarter', till_id: 'till-2', trust: 'claimed', started_at: at(12, 0), ended_at: null, end_reason: null, ip: '203.0.113.20' },
      { id: 's1', staff_id: SAM, staff_name: 'Sam Staff', till_id: 'till-1', trust: 'pin', started_at: at(9, 0), ended_at: at(12, 30), end_reason: 'idle_lock', ip: '203.0.113.10' },
    ])
    renderPage()
    await screen.findByText('Nothing here')
    expect(screen.queryByRole('region', { name: 'Who was signed in' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Sign-ins' }))

    const panel = await screen.findByRole('region', { name: 'Who was signed in' })
    await waitFor(() => expect(fetchAuditSessions).toHaveBeenCalledWith(RANGE.from, RANGE.to))
    const rows = await within(panel).findAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Kim Newstarter')
    expect(rows[0]).toHaveTextContent('Till 2')
    expect(rows[0]).toHaveTextContent('said to be')
    expect(rows[0]).toHaveTextContent('still signed in')
    expect(rows[1]).toHaveTextContent('Sam Staff')
    expect(rows[1]).toHaveTextContent('PIN checked')
    expect(rows[1]).toHaveTextContent('09:00 to 12:30')
    expect(rows[1]).toHaveTextContent('till locked itself')
    expect(lastFilters()[0]).toEqual({ kinds: ['auth'], from: RANGE.from, to: RANGE.to })
  })

  it('reloads everything with Refresh', async () => {
    renderPage()
    await screen.findByText('Nothing here')
    expect(fetchAuditHealth).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    await waitFor(() => expect(fetchAuditEntries).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(fetchAuditHealth).toHaveBeenCalledTimes(2))
    expect(fetchAuditEntries).toHaveBeenLastCalledWith([{ unchecked: true }], { limit: 100 })
  })
})

describe('AuditPage — paging', () => {
  it('loads more with the cursor the last page gave', async () => {
    fetchAuditEntries
      .mockResolvedValueOnce(page([priceChange(120), blockedDelete(119)], 119))
      .mockResolvedValueOnce(page([drawerOpened(118)], null))
    renderPage()
    await screen.findByText('Changed Guinness standard price from £7.40 to £6.40')
    expect(screen.queryByText('Cash drawer opened without a sale (from the Settings page)')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

    expect(await screen.findByText('Cash drawer opened without a sale (from the Settings page)')).toBeInTheDocument()
    expect(fetchAuditEntries).toHaveBeenCalledTimes(2)
    expect(fetchAuditEntries).toHaveBeenLastCalledWith([{ unchecked: true }], { beforeSeq: 119, limit: 100 })
    // the earlier entries are still there, and there is nothing more to load
    expect(screen.getByText('Changed Guinness standard price from £7.40 to £6.40')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
  })

  it('does not offer "Load more" when the first page was everything', async () => {
    fetchAuditEntries.mockResolvedValue(page([priceChange(120)], null))
    renderPage()
    await screen.findByText('Changed Guinness standard price from £7.40 to £6.40')
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
  })

  it('keeps what is on screen if loading more fails, and lets you try again', async () => {
    fetchAuditEntries
      .mockResolvedValueOnce(page([priceChange(120)], 120))
      .mockRejectedValueOnce(errorOf('offline', 'Could not reach the server. Check the connection and try again.'))
    renderPage()
    await screen.findByText('Changed Guinness standard price from £7.40 to £6.40')

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

    expect(await screen.findByText(/Could not load more: Could not reach the server/)).toBeInTheDocument()
    expect(screen.getByText('Changed Guinness standard price from £7.40 to £6.40')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Load more' })).toBeInTheDocument()
  })

  it('shows a sale and its lines as one entry', async () => {
    fetchAuditEntries.mockResolvedValue(page([saleLines(111), sale(110)]))
    renderPage()
    expect(await screen.findByText('Sale of £13.80 on tab: 2 × Guinness, 1 × Crisps')).toBeInTheDocument()
    expect(screen.getByText('Put on Mo Member’s tab')).toBeInTheDocument()
    expect(screen.queryByText(/^Sale lines:/)).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Full detail' })).toHaveLength(1)
  })
})

describe('AuditPage — the health strip', () => {
  it('is quiet when all is well', async () => {
    fetchAuditHealth.mockResolvedValue(healthy({ unchecked_alerts: 0 }))
    renderPage()
    const strip = await screen.findByRole('region', { name: 'Log health' })
    expect(await within(strip).findByText('Everything is being recorded, and nothing is wrong with the log itself.')).toBeInTheDocument()
    expect(within(strip).queryByRole('alert')).not.toBeInTheDocument()
    expect(within(strip).getByText('S42-4F2A-91BC · 13:57 (3 minutes ago)')).toBeInTheDocument()
    expect(within(strip).getByText('13:58 (2 minutes ago)')).toBeInTheDocument()
    expect(within(strip).getByText('passed · 05:17 (9 hours ago)')).toBeInTheDocument()
    expect(within(strip).getByText('4.2 MB · 12,340 entries (310 in the last 24 hours)')).toBeInTheDocument()
    expect(within(strip).queryByRole('button', { name: /need a look|needs a look/ })).not.toBeInTheDocument()
  })

  it('makes anything wrong impossible to miss', async () => {
    fetchAuditHealth.mockResolvedValue(healthy({
      settings: { capture_enabled: false, guards_enforced: true, session_max_hours: 24 },
      coverage: { tables: 22, missing: ['order_items:insert'], disabled: ['orders'] },
      capture_failures_7d: 4,
    }))
    renderPage()
    const strip = await screen.findByRole('region', { name: 'Log health' })
    const alert = await within(strip).findByRole('alert')
    expect(alert).toHaveTextContent('Something is wrong with the log')
    expect(alert).toHaveTextContent('Recording is switched OFF')
    expect(alert).toHaveTextContent('Not being recorded: new sale lines.')
    expect(alert).toHaveTextContent('Recording has been switched off for: sales.')
    expect(within(strip).getByText('4 changes could not be recorded in the last 7 days.')).toBeInTheDocument()
    expect(within(strip).queryByText('Everything is being recorded, and nothing is wrong with the log itself.')).not.toBeInTheDocument()
  })

  it('warns when this till remembers a newer seal than the database holds', async () => {
    rememberedSeal.mockReturnValue({ id: 50, code: 'S50-AAAA-BBBB', hash: 'bb'.repeat(32), at: at(13) })
    renderPage()
    const strip = await screen.findByRole('region', { name: 'Log health' })
    expect(await within(strip).findByRole('alert')).toHaveTextContent('This till has seen a newer seal (S50-AAAA-BBBB) than the database now holds (S42-4F2A-91BC)')
  })

  it('the alerts button jumps back to "Needs a look"', async () => {
    renderPage()
    await screen.findByText('Nothing here')
    fireEvent.click(screen.getByRole('button', { name: 'Everything' }))
    await waitFor(() => expect(fetchAuditEntries).toHaveBeenCalledTimes(2))

    fireEvent.click(screen.getByRole('button', { name: '3 alerts need a look' }))

    await waitFor(() => expect(fetchAuditEntries).toHaveBeenCalledTimes(3))
    expect(fetchAuditEntries).toHaveBeenLastCalledWith([{ unchecked: true }], { limit: 100 })
  })

  it('"Check now" shows a clear pass and refreshes the facts', async () => {
    renderPage()
    await screen.findByText('Nothing here')
    expect(fetchAuditHealth).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Check now' }))

    const result = await screen.findByRole('status')
    expect(result).toHaveTextContent('Checked just now: all 12,345 entries are intact and nothing has been altered. Newest seal S43-AB12-CD34.')
    expect(verifyAuditNow).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(fetchAuditHealth).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('button', { name: 'Check now' })).not.toBeDisabled()
  })

  it('"Check now" spells out each problem when the check fails', async () => {
    verifyAuditNow.mockResolvedValue({
      ok: false, seals_checked: 43, rows_checked: 12345, unsealed_rows: 0,
      problems: [
        { seal: 3, problem: 'row_content_changed', seq: 57 },
        { seal: 4, problem: 'row_count_changed', expected: 50, found: 49 },
        { problem: 'seal_missing', rows: 12 },
      ],
      head: { id: 43, code: 'S43-AB12-CD34' },
    })
    renderPage()
    await screen.findByText('Nothing here')

    fireEvent.click(screen.getByRole('button', { name: 'Check now' }))

    const failed = (await screen.findByText('The check FAILED — the log has been altered or damaged')).closest('[role="alert"]')
    expect(within(failed).getByText('Entry number 57 has been altered since it was recorded (sealed batch 3).')).toBeInTheDocument()
    expect(within(failed).getByText('Sealed batch 4 should hold 50 entries but now holds 49 — entries have been removed or added.')).toBeInTheDocument()
    expect(within(failed).getByText('12 entries point to a seal that no longer exists.')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('says so when the check itself could not be run', async () => {
    verifyAuditNow.mockRejectedValue(errorOf('offline', 'Could not reach the server. Check the connection and try again.'))
    renderPage()
    await screen.findByText('Nothing here')
    fireEvent.click(screen.getByRole('button', { name: 'Check now' }))
    expect(await screen.findByText(/Could not run the check: Could not reach the server/)).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('offers a retry when the health of the log could not be read', async () => {
    fetchAuditHealth.mockRejectedValueOnce(errorOf('failed', 'boom')).mockResolvedValue(healthy({ unchecked_alerts: 0 }))
    renderPage()
    const strip = await screen.findByRole('region', { name: 'Log health' })
    expect(await within(strip).findByText(/Could not check whether the log is healthy: boom/)).toBeInTheDocument()

    fireEvent.click(within(strip).getByRole('button', { name: 'Try again' }))

    expect(await within(strip).findByText('Everything is being recorded, and nothing is wrong with the log itself.')).toBeInTheDocument()
  })
})

describe('AuditPage — when the log cannot be shown', () => {
  it('explains that the database update has not landed yet', async () => {
    const missing = errorOf('not_available', 'The log will be available once the database update has been applied')
    fetchAuditEntries.mockRejectedValue(missing)
    fetchAuditHealth.mockRejectedValue(missing)
    renderPage()

    expect(await screen.findByText('The log will be available once the database update has been applied')).toBeInTheDocument()
    expect(screen.getByText(/Nothing is wrong with the till/)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Log health' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Check now' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Search the log')).not.toBeInTheDocument()

    // ...and comes back by itself once the update is there
    fetchAuditEntries.mockResolvedValue(page([priceChange(120)]))
    fetchAuditHealth.mockResolvedValue(healthy())
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Changed Guinness standard price from £7.40 to £6.40')).toBeInTheDocument()
    expect(screen.queryByText('The log will be available once the database update has been applied')).not.toBeInTheDocument()
  })

  describe('when the server does not know who is signed in', () => {
    beforeEach(() => {
      const noStaff = errorOf('not_signed_in', 'Sign in with your PIN to see the log')
      fetchAuditEntries.mockRejectedValue(noStaff)
      fetchAuditHealth.mockRejectedValue(noStaff)
    })

    it('says so plainly, and to sign in again with a PIN', async () => {
      setAuditHeadersEnabled(true)
      renderPage()
      expect(await screen.findByText('Sign in with your PIN to see the log')).toBeInTheDocument()
      expect(screen.getByText(/your sign-in on this till is from before the log was switched on\. Sign out, sign back in with your PIN/)).toBeInTheDocument()
      expect(screen.queryByRole('region', { name: 'Log health' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    })

    it('says the sign-in is too old when the till does hold one', async () => {
      setAuditHeadersEnabled(true)
      setStaffSession({ id: 'session-1', token: 'not-shown-anywhere', staffId: SAM, trust: 'pin' })
      const { container } = renderPage()
      expect(await screen.findByText(/your PIN sign-in is too old for it/)).toBeInTheDocument()
      expect(container.textContent).not.toContain('not-shown-anywhere')
    })

    it('does not tell staff to sign in again while the till is still setting up its link', async () => {
      renderPage()
      expect(await screen.findByText(/this till has not yet finished setting up the link/)).toBeInTheDocument()
      expect(screen.queryByText(/Sign out, sign back in/)).not.toBeInTheDocument()
    })
  })

  it('says plainly when this device is not allowed', async () => {
    const refused = errorOf('not_allowed', 'The log can only be opened from a till')
    fetchAuditEntries.mockRejectedValue(refused)
    fetchAuditHealth.mockRejectedValue(refused)
    renderPage()
    expect(await screen.findByText('This device is not allowed to open the log')).toBeInTheDocument()
  })

  it('shows any other error with a retry', async () => {
    fetchAuditEntries.mockRejectedValueOnce(errorOf('failed', 'boom')).mockResolvedValue(page([priceChange(120)]))
    renderPage()

    expect(await screen.findByText('Could not load the log')).toBeInTheDocument()
    expect(screen.getByText('boom')).toBeInTheDocument()
    // the rest of the page is still there
    expect(screen.getByRole('region', { name: 'Log health' })).toBeInTheDocument()

    const panel = screen.getByText('Could not load the log').closest('[role="alert"]')
    fireEvent.click(within(panel).getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('Changed Guinness standard price from £7.40 to £6.40')).toBeInTheDocument()
    expect(screen.queryByText('Could not load the log')).not.toBeInTheDocument()
  })
})

describe('AuditPage — the history of one record (deep link)', () => {
  it('/log?table=products&pk=… opens that product’s whole history', async () => {
    fetchAuditEntries.mockResolvedValue(page([priceChange(120, { checked: true })]))
    renderPage(`/log?table=products&pk=${GUINNESS}`)

    expect(await screen.findByText('Changed Guinness standard price from £7.40 to £6.40')).toBeInTheDocument()
    expect(fetchAuditEntries).toHaveBeenCalledTimes(1)
    expect(fetchAuditEntries).toHaveBeenCalledWith([{ table: 'products', pk: GUINNESS }], { limit: 100 })
    expect(screen.getByText('Everything recorded about product Guinness')).toBeInTheDocument()
    // the quick views and dates do not apply to one record's history
    expect(screen.queryByRole('group', { name: 'Quick views' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('From')).not.toBeInTheDocument()
  })

  it('goes back to the whole log', async () => {
    renderPage(`/log?table=products&pk=${GUINNESS}`)
    await screen.findByText('Nothing here')
    expect(screen.getByText('Nothing has been recorded about this yet.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Back to the whole log' }))

    await waitFor(() => expect(fetchAuditEntries).toHaveBeenLastCalledWith([{ unchecked: true }], { limit: 100 }))
    expect(screen.getByRole('group', { name: 'Quick views' })).toBeInTheDocument()
  })

  it('a sale’s history includes its lines', async () => {
    renderPage(`/log?table=orders&pk=${ORDER1}`)
    await screen.findByText('Nothing here')
    expect(fetchAuditEntries).toHaveBeenCalledWith([{ table: 'orders', pk: ORDER1 }, { table: 'order_items', pk: ORDER1 }], { limit: 100 })
  })

  it('ignores a link that is not a record', async () => {
    renderPage('/log?table=products')
    await screen.findByText('Nothing here')
    expect(fetchAuditEntries).toHaveBeenCalledWith([{ unchecked: true }], { limit: 100 })
  })

  it('an entry can open the history of its own record', async () => {
    fetchAuditEntries.mockResolvedValue(page([priceChange(120)]))
    renderPage()
    const card = (await screen.findByText('Changed Guinness standard price from £7.40 to £6.40')).closest('li')
    fireEvent.click(within(card).getByRole('button', { name: 'Full detail' }))

    fireEvent.click(within(card).getByRole('button', { name: 'Everything recorded about this product' }))

    await waitFor(() => expect(fetchAuditEntries).toHaveBeenLastCalledWith([{ table: 'products', pk: GUINNESS }], { limit: 100 }))
    expect(await screen.findByText('Everything recorded about product Guinness')).toBeInTheDocument()
  })
})

describe('AuditPage — one entry in full', () => {
  it('the expander shows before and after, how it arrived, and whether it is sealed', async () => {
    fetchAuditEntries.mockResolvedValue(page([priceChange(120)]))
    renderPage()
    const card = (await screen.findByText('Changed Guinness standard price from £7.40 to £6.40')).closest('li')
    expect(within(card).queryByText('Before and after')).not.toBeInTheDocument()

    fireEvent.click(within(card).getByRole('button', { name: 'Full detail' }))

    expect(within(card).getByText('Before and after')).toBeInTheDocument()
    expect(within(card).getByText('standard price')).toBeInTheDocument()
    expect(within(card).getByText('£7.40')).toBeInTheDocument()
    expect(within(card).getByText('£6.40')).toBeInTheDocument()
    expect(within(card).getByText('Straight to the products list (editing)')).toBeInTheDocument()
    expect(within(card).getByText('203.0.113.10')).toBeInTheDocument()
    expect(within(card).getByText('test123')).toBeInTheDocument()
    expect(within(card).getByText('Sealed:').nextSibling).toHaveTextContent('yes')
    expect(within(card).getByText('Entry number:').nextSibling).toHaveTextContent('120')

    fireEvent.click(within(card).getByRole('button', { name: 'Hide detail' }))
    expect(within(card).queryByText('Before and after')).not.toBeInTheDocument()
  })

  it('says when an entry is not sealed yet', async () => {
    fetchAuditEntries.mockResolvedValue(page([priceChange(120, { sealed: false })]))
    renderPage()
    const card = (await screen.findByText('Changed Guinness standard price from £7.40 to £6.40')).closest('li')
    fireEvent.click(within(card).getByRole('button', { name: 'Full detail' }))
    expect(within(card).getByText('Sealed:').nextSibling).toHaveTextContent('not yet')
  })

  it('shows "happened …, arrived …" when the till’s clock and the log differ by more than two minutes', async () => {
    const late = drawerOpened(118, { at: at(17, 31), client_at: at(14, 2) })
    const onTime = drawerOpened(117, { at: at(12, 1), client_at: at(12, 0), detail: { source: 'cashback', till: 'till-1', page: '/' } })
    fetchAuditEntries.mockResolvedValue(page([late, onTime]))
    renderPage()

    const lateCard = (await screen.findByText('Cash drawer opened without a sale (from the Settings page)')).closest('li')
    expect(within(lateCard).getByText('happened 14:02, arrived 17:31')).toBeInTheDocument()
    const onTimeCard = screen.getByText('Cash drawer opened without a sale (from cashback)').closest('li')
    expect(within(onTimeCard).queryByText(/happened/)).not.toBeInTheDocument()
  })

  it('never shows a PIN value, a raw id as the headline, or database jargon', async () => {
    const pinSet = {
      ...base, seq: 130, at: at(13, 30), kind: 'row', action: 'update', table: 'members', pk: KIM, subject: 'Kim Newstarter', severity: 1,
      changed: ['pin_hash'], old: { pin_hash: null }, new: { pin_hash: '[redacted]' }, detail: { flags: ['pin_changed'] },
    }
    const wrongPin = {
      ...base, seq: 129, at: at(13, 29), kind: 'auth', action: 'pin.wrong_pin', table: 'members', pk: SAM, subject: 'Sam Staff', severity: 1,
      staff_id: null, staff_name: null, staff_trust: 'none', via: 'POST /rpc/staff_sign_in', detail: { purpose: 'sign_in', attempts_remaining: 3 },
    }
    const failedCheck = {
      ...base, seq: 128, at: at(13, 28), kind: 'system', action: 'integrity.FAILED', severity: 3,
      via: 'POST /rpc/audit_verify_now', detail: { ok: false, rows_checked: 10, seals_checked: 2, unsealed_rows: 0, problems: [{ seal: 3, problem: 'rows_do_not_match_seal' }] },
    }
    const outside = {
      ...base, seq: 127, at: at(13, 27), kind: 'row', action: 'insert', table: 'stock_movements', pk: null, severity: 2,
      actor: 'database', till_id: null, staff_id: null, staff_name: null, staff_trust: 'none', via: 'sql:postgres/psql', ip: null, app_build: null,
      new: [{ id: 'e2000000-0000-0000-0000-000000000001', product_id: GUINNESS, type: 'adjustment', quantity: 5, notes: null, member_id: null }],
      detail: { rows: 1, flags: ['outside_the_till'] },
    }
    fetchAuditEntries.mockResolvedValue(page([pinSet, wrongPin, failedCheck, outside, priceChange(120), blockedDelete(119), saleLines(111), sale(110)]))
    const { container } = renderPage()

    expect(await screen.findByText('PIN set for Kim Newstarter')).toBeInTheDocument()
    expect(screen.getByText('Wrong PIN for Sam Staff — 3 tries left')).toBeInTheDocument()
    expect(screen.getByText('Stock adjustment: 5 × Guinness')).toBeInTheDocument()
    expect(screen.getByText('Someone working directly in the database')).toBeInTheDocument()

    for (const button of screen.getAllByRole('button', { name: 'Full detail' })) fireEvent.click(button)

    const text = container.textContent
    expect(text).toContain('PIN set (hidden)')
    expect(text).not.toMatch(/redacted|pin_hash/i)
    expect(text).not.toMatch(/\b(rows?|rpc|triggers?|hash(es)?|uuid)\b/i)
    for (const headline of [...container.querySelectorAll('li > div > div > p:first-of-type')]) {
      expect(headline.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
    }
  })

  it('gives every button a touch-sized target', async () => {
    fetchAuditEntries.mockResolvedValue(page([priceChange(120)], 120))
    renderPage()
    await screen.findByText('Changed Guinness standard price from £7.40 to £6.40')
    await screen.findByRole('button', { name: '3 alerts need a look' })
    for (const button of screen.getAllByRole('button')) {
      expect(button.className, button.textContent).toMatch(/min-h-\[44px\]/)
    }
  })
})
