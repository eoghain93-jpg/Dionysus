import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import TillPage from './TillPage'
import { useTillStore } from '../stores/tillStore'
import { useSessionStore } from '../stores/sessionStore'
import { useToastStore } from '../hooks/useToast'
import { saveOrder } from '../lib/orders'
import { printReceipt, getPrinterIp } from '../lib/starPrinter'
import { logEvent } from '../lib/audit/log'

vi.mock('../lib/audit/log', () => ({ logEvent: vi.fn() }))
vi.mock('../lib/products', () => ({ fetchProducts: vi.fn().mockResolvedValue([]) }))
vi.mock('../lib/promotions', () => ({ fetchActivePromotions: vi.fn().mockResolvedValue([]) }))
vi.mock('../lib/orders', () => ({
  newOrderId: vi.fn(() => 'order-0001'),
  saveOrder: vi.fn(),
}))
vi.mock('../lib/till', () => ({ getTillId: vi.fn(() => 'till-1') }))
vi.mock('../lib/tabs', () => ({
  fetchTabAges: vi.fn().mockResolvedValue({}),
  isTabBlocked: vi.fn().mockResolvedValue(false),
}))
vi.mock('../lib/starPrinter', () => ({
  printReceipt: vi.fn(),
  getPrinterIp: vi.fn(),
}))

// The page is tested for what IT does (checkout, and the handlers it passes
// down); every child is a stub with just enough buttons to drive them.
vi.mock('../components/till/PinLoginScreen', () => ({ default: () => <div data-testid="pin-login" /> }))
vi.mock('../components/till/CategoryFilter', () => ({ default: () => null }))
vi.mock('../components/till/ProductGrid', () => ({ default: () => null }))
vi.mock('../components/till/MemberLookup', () => ({ default: () => null }))
vi.mock('../components/till/MembersOnlyToggle', () => ({ default: () => null }))
vi.mock('../components/till/WastageModal', () => ({ default: () => null }))
vi.mock('../components/till/StaffDrinkModal', () => ({ default: () => null }))
vi.mock('../components/till/CashbackModal', () => ({ default: () => null }))
vi.mock('../components/till/PrizeWinModal', () => ({ default: () => null }))
vi.mock('../components/till/ShotBundleModal', () => ({ default: () => null }))
vi.mock('../components/till/BottleBundleModal', () => ({ default: () => null }))
vi.mock('../components/guests/GuestSignInModal', () => ({ default: () => null }))
vi.mock('../components/till/RecentSalesModal', () => ({
  default: () => <div data-testid="recent-sales" />,
}))
vi.mock('../components/till/OrderPanel', () => ({
  default: ({ onCheckout }) => (
    <div>
      <button onClick={() => onCheckout('card')}>Pay Card</button>
      <button onClick={() => onCheckout('cash')}>Pay Cash</button>
      <button onClick={() => onCheckout('tab')}>Pay Tab</button>
    </div>
  ),
}))
vi.mock('../components/till/OneForStaffModal', () => ({
  default: ({ onAdd }) => (
    <div>
      <button onClick={() => onAdd({ id: 'p1', name: 'Guinness', standard_price: 7.4 }, { id: 'staff-9', name: 'Dave' })}>
        Credit for Dave
      </button>
      <button onClick={() => onAdd({ id: 'p1', name: 'Guinness', standard_price: 7.4 }, { id: 'staff-1', name: 'Sam' })}>
        Credit for Sam
      </button>
    </div>
  ),
}))

const guinness = { product_id: 'p1', name: 'Guinness', quantity: 2, unit_price: 7.4, subtotal: 14.8, member_price_applied: false }
const lager = { product_id: 'p2', name: 'Lager', quantity: 1, unit_price: 5, subtotal: 5, member_price_applied: true }

const eventsOfType = type => logEvent.mock.calls.filter(c => c[0] === type)
let consoleError

function renderTill(state = {}) {
  useSessionStore.setState({ activeStaff: { id: 'staff-1', name: 'Sam' } })
  useTillStore.setState({ orderItems: [guinness, lager], activeMember: null, membersOnlyMode: false, ...state })
  return render(<TillPage />)
}

async function pay(method = 'Card') {
  // The desktop and mobile panels can both be mounted; either drives the same handler.
  await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: `Pay ${method}` })[0]) })
  await waitFor(() => expect(useTillStore.getState().orderItems).toEqual([]))
}

beforeEach(() => {
  vi.clearAllMocks()
  saveOrder.mockResolvedValue('online')
  printReceipt.mockResolvedValue(undefined)
  getPrinterIp.mockReturnValue('192.168.1.100')
  useToastStore.setState({ toasts: [] })
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => consoleError.mockRestore())

describe('TillPage — sale.completed', () => {
  it('logs the sale once it has been saved and the receipt printed', async () => {
    renderTill()
    await pay('Card')
    expect(saveOrder).toHaveBeenCalledOnce()
    expect(printReceipt).toHaveBeenCalledOnce()
    expect(logEvent.mock.calls).toEqual([
      ['sale.completed', {
        order_id: 'order-0001', total: 19.8, method: 'card', lines: 2, saved: 'online', printed: true,
      }, { severity: 0 }],
    ])
  })

  it('is logged AFTER saveOrder returns, never before', async () => {
    let finishSave
    saveOrder.mockReturnValue(new Promise(resolve => { finishSave = resolve }))
    renderTill()
    fireEvent.click(screen.getAllByRole('button', { name: 'Pay Card' })[0])
    await waitFor(() => expect(saveOrder).toHaveBeenCalled())
    expect(logEvent).not.toHaveBeenCalled()
    await act(async () => { finishSave('online') })
    await waitFor(() => expect(eventsOfType('sale.completed')).toHaveLength(1))
  })

  it.each([
    ['offline', 1],
    ['fallback', 1],
  ])('a sale saved %s is severity %i', async (saved, severity) => {
    saveOrder.mockResolvedValue(saved)
    renderTill()
    await pay('Cash')
    const [[, detail, opts]] = eventsOfType('sale.completed')
    expect(detail).toMatchObject({ order_id: 'order-0001', method: 'cash', saved, printed: true })
    expect(detail).not.toHaveProperty('items')
    expect(opts).toEqual({ severity })
  })

  it('a sale that could not be stored anywhere is severity 2 and carries its lines', async () => {
    saveOrder.mockResolvedValue('failed')
    renderTill({ activeMember: { id: 'm1', name: 'Alice', pin_hash: 'SECRET', phone: '07700 900123' } })
    await pay('Card')
    // exactly as before: the receipt still prints and the order is cleared
    expect(printReceipt).toHaveBeenCalledOnce()
    expect(eventsOfType('sale.completed')).toEqual([
      ['sale.completed', {
        order_id: 'order-0001',
        total: 19.8,
        method: 'card',
        lines: 2,
        saved: 'failed',
        printed: true,
        member_id: 'm1',
        items: [
          { product_id: 'p1', quantity: 2, unit_price: 7.4 },
          { product_id: 'p2', quantity: 1, unit_price: 5 },
        ],
      }, { severity: 2 }],
    ])
    // the member's id, never the member record
    const logged = JSON.stringify(logEvent.mock.calls)
    expect(logged).not.toContain('SECRET')
    expect(logged).not.toContain('07700')
  })

  it('printed is false, and the failure is logged, when the receipt does not print', async () => {
    printReceipt.mockRejectedValue(new Error('Bridge returned 502: printer offline'))
    renderTill()
    await pay('Card')
    expect(logEvent.mock.calls).toEqual([
      ['receipt.print_failed', {
        what: 'receipt', message: 'Bridge returned 502: printer offline', order_id: 'order-0001',
      }, { severity: 1 }],
      ['sale.completed', {
        order_id: 'order-0001', total: 19.8, method: 'card', lines: 2, saved: 'online', printed: false,
      }, { severity: 0 }],
    ])
  })

  it('printed is false when no printer is configured (the job is silently skipped)', async () => {
    getPrinterIp.mockReturnValue(null)
    renderTill()
    await pay('Card')
    expect(eventsOfType('sale.completed')[0][1]).toMatchObject({ printed: false })
    expect(eventsOfType('receipt.print_failed')).toEqual([])
  })

  it('the order sent to saveOrder is unchanged by the logging', async () => {
    renderTill({ activeMember: { id: 'm1', name: 'Alice' } })
    await pay('Tab')
    const [order, items] = saveOrder.mock.calls[0]
    expect(order).toMatchObject({
      id: 'order-0001', member_id: 'm1', staff_id: 'staff-1', payment_method: 'tab',
      total_amount: 19.8, status: 'paid', till_id: 'till-1',
    })
    expect(items).toEqual([
      { product_id: 'p1', quantity: 2, unit_price: 7.4, member_price_applied: false, staff_credit_for: null },
      { product_id: 'p2', quantity: 1, unit_price: 5, member_price_applied: true, staff_credit_for: null },
    ])
  })
})

describe('TillPage — one for staff', () => {
  it('logs who the drink was rung for', () => {
    renderTill({ orderItems: [] })
    fireEvent.click(screen.getByRole('button', { name: 'One for Staff' }))
    fireEvent.click(screen.getByRole('button', { name: 'Credit for Dave' }))
    expect(useTillStore.getState().orderItems).toHaveLength(1)
    expect(logEvent.mock.calls).toEqual([
      ['cart.staff_credit_added', {
        product: 'Guinness', for_staff_id: 'staff-9', for_staff_name: 'Dave', self_award: false,
      }, { severity: 0 }],
    ])
  })

  it('flags the server ringing one in for themselves', () => {
    renderTill({ orderItems: [] })
    fireEvent.click(screen.getByRole('button', { name: 'One for Staff' }))
    fireEvent.click(screen.getByRole('button', { name: 'Credit for Sam' }))
    expect(logEvent.mock.calls).toEqual([
      ['cart.staff_credit_added', {
        product: 'Guinness', for_staff_id: 'staff-1', for_staff_name: 'Sam', self_award: true,
      }, { severity: 1 }],
    ])
  })
})

describe('TillPage — other events', () => {
  it('logs that today\'s sales list was opened (Fix Payment)', () => {
    renderTill()
    fireEvent.click(screen.getByRole('button', { name: 'Fix Payment' }))
    expect(screen.getByTestId('recent-sales')).toBeInTheDocument()
    expect(logEvent.mock.calls).toEqual([['sales.recent_viewed']])
  })

  it('logs members-only mode switching itself off when the till has no staff', () => {
    useSessionStore.setState({ activeStaff: null })
    useTillStore.setState({ orderItems: [], activeMember: null, membersOnlyMode: true })
    render(<TillPage />)
    expect(screen.getByTestId('pin-login')).toBeInTheDocument()
    expect(useTillStore.getState().membersOnlyMode).toBe(false)
    expect(logEvent.mock.calls).toEqual([
      ['pricing.members_only_mode_off', { reason: 'staff_signed_out' }, { severity: 1 }],
    ])
  })

  it('logs nothing at the PIN screen when the mode was already off', () => {
    useSessionStore.setState({ activeStaff: null })
    useTillStore.setState({ orderItems: [], activeMember: null, membersOnlyMode: false })
    render(<TillPage />)
    expect(logEvent).not.toHaveBeenCalled()
  })

  it('logs nothing just for showing the till', async () => {
    renderTill()
    await waitFor(() => expect(screen.getByText(/no products in this category/i)).toBeInTheDocument())
    expect(logEvent).not.toHaveBeenCalled()
  })
})
