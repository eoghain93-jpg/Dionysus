import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import OrderPanel from './OrderPanel'
import { useTillStore } from '../../stores/tillStore'
import { logEvent } from '../../lib/audit/log'

vi.mock('../../lib/audit/log', () => ({ logEvent: vi.fn() }))

const guinness = { product_id: 'p1', name: 'Guinness', quantity: 3, unit_price: 7.4, subtotal: 22.2, member_price_applied: false, promo_price_applied: false }
const lager = { product_id: 'p2', name: 'Lager', quantity: 1, unit_price: 5, subtotal: 5, member_price_applied: false, promo_price_applied: false }
const alice = { id: 'm1', name: 'Alice', membership_number: 'M0001', tab_balance: 12.5 }

function renderPanel(state = {}) {
  useTillStore.setState({ orderItems: [], activeMember: null, membersOnlyMode: false, ...state })
  const onCheckout = vi.fn().mockResolvedValue(undefined)
  render(<OrderPanel onCheckout={onCheckout} />)
  return { onCheckout }
}

const items = () => useTillStore.getState().orderItems

beforeEach(() => {
  vi.clearAllMocks()
})

describe('OrderPanel — removing a line', () => {
  it('removes the line and logs what came off the order', () => {
    renderPanel({ orderItems: [guinness, lager] })
    fireEvent.click(screen.getByRole('button', { name: 'Remove Guinness' }))
    expect(items().map(i => i.name)).toEqual(['Lager'])
    expect(logEvent.mock.calls).toEqual([
      ['cart.line_removed', { product: 'Guinness', quantity: 3, unit_price: 7.4, value: 22.2 }, { severity: 1 }],
    ])
  })

  it('logs BOTH lines when one tap removes two (a shot-bundle line shares its key with a plain line)', () => {
    const plain = { product_id: 's1', name: 'Sambuca', quantity: 1, unit_price: 4, subtotal: 4 }
    const bundle = { product_id: 's1', name: 'Sambuca', quantity: 2, unit_price: 2.5, subtotal: 5, bundle_price_applied: true }
    // The two lines also share a React key in the live panel; keep that
    // long-standing warning out of the test output.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderPanel({ orderItems: [plain, bundle] })
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove Sambuca' })[0])
    consoleError.mockRestore()
    expect(items()).toEqual([])
    expect(logEvent.mock.calls).toEqual([
      ['cart.line_removed', { product: 'Sambuca', quantity: 1, unit_price: 4, value: 4 }, { severity: 1 }],
      ['cart.line_removed', { product: 'Sambuca', quantity: 2, unit_price: 2.5, value: 5, bundle: true }, { severity: 1 }],
    ])
  })

  it('says whose drink it was when a "one for staff" line is removed', () => {
    const credit = { line_id: 'credit:s9:p1', product_id: 'p1', name: 'Guinness', quantity: 1, unit_price: 7.4, subtotal: 7.4, staff_credit_for: 's9', staff_credit_name: 'Dave' }
    renderPanel({ orderItems: [guinness, credit] })
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove Guinness' })[1])
    // only the credit line went — the buyer's own Guinness stays
    expect(items()).toEqual([guinness])
    expect(logEvent.mock.calls).toEqual([
      ['cart.line_removed', { product: 'Guinness', quantity: 1, unit_price: 7.4, value: 7.4, for_staff: 'Dave' }, { severity: 1 }],
    ])
  })
})

describe('OrderPanel — changing a quantity', () => {
  it('logs cart.quantity_reduced with the value taken off', () => {
    renderPanel({ orderItems: [guinness] })
    fireEvent.click(screen.getByRole('button', { name: 'Decrease quantity' }))
    expect(items()[0].quantity).toBe(2)
    expect(logEvent.mock.calls).toEqual([
      ['cart.quantity_reduced', { product: 'Guinness', from: 3, to: 2, value_removed: 7.4 }, { severity: 1 }],
    ])
  })

  it('minus to zero counts as a removed line, not a reduced quantity', () => {
    renderPanel({ orderItems: [lager] })
    fireEvent.click(screen.getByRole('button', { name: 'Decrease quantity' }))
    expect(items()).toEqual([])
    expect(logEvent.mock.calls).toEqual([
      ['cart.line_removed', { product: 'Lager', quantity: 1, unit_price: 5, value: 5 }, { severity: 1 }],
    ])
  })

  it('logs nothing when a plain quantity goes up', () => {
    renderPanel({ orderItems: [guinness] })
    fireEvent.click(screen.getByRole('button', { name: 'Increase quantity' }))
    expect(items()[0].quantity).toBe(4)
    expect(logEvent).not.toHaveBeenCalled()
  })

  it('logs a bundle line raised above what the deal covers', () => {
    const bundle = { line_id: 'bundle:x', product_id: 'b1', name: 'San Miguel', quantity: 5, unit_price: 4.2, subtotal: 21, bundle_price_applied: true }
    renderPanel({ orderItems: [bundle] })
    fireEvent.click(screen.getByRole('button', { name: 'Increase quantity' }))
    expect(items()[0].quantity).toBe(6)
    expect(logEvent.mock.calls).toEqual([
      ['cart.bundle_quantity_increased', { product: 'San Miguel', from: 5, to: 6, unit_price: 4.2 }, { severity: 1 }],
    ])
  })

  it('flags a reduced bundle line (deal price kept without the full deal)', () => {
    const bundle = { line_id: 'bundle:x', product_id: 'b1', name: 'San Miguel', quantity: 5, unit_price: 4.2, subtotal: 21, bundle_price_applied: true }
    renderPanel({ orderItems: [bundle] })
    fireEvent.click(screen.getByRole('button', { name: 'Decrease quantity' }))
    expect(logEvent.mock.calls).toEqual([
      ['cart.quantity_reduced', { product: 'San Miguel', from: 5, to: 4, value_removed: 4.2, bundle: true }, { severity: 1 }],
    ])
  })
})

describe('OrderPanel — Void Order', () => {
  it('clears the order and logs what was thrown away', () => {
    renderPanel({ orderItems: [guinness, lager], activeMember: alice })
    fireEvent.click(screen.getByRole('button', { name: /void order/i }))
    expect(items()).toEqual([])
    expect(useTillStore.getState().activeMember).toBeNull()
    expect(logEvent.mock.calls).toEqual([
      ['cart.order_voided', {
        lines: 2,
        value: 27.2,
        member: 'Alice',
        member_id: 'm1',
        items: [
          { product: 'Guinness', quantity: 3, value: 22.2 },
          { product: 'Lager', quantity: 1, value: 5 },
        ],
      }, { severity: 1 }],
    ])
  })

  it('records a walk-in order with member: null', () => {
    renderPanel({ orderItems: [lager] })
    fireEvent.click(screen.getByRole('button', { name: /void order/i }))
    expect(logEvent.mock.calls[0][1]).toMatchObject({ lines: 1, value: 5, member: null, member_id: null })
  })

  it('offers no Void Order (and so logs nothing) on an empty order', () => {
    renderPanel()
    expect(screen.queryByRole('button', { name: /void order/i })).not.toBeInTheDocument()
    expect(logEvent).not.toHaveBeenCalled()
  })
})

describe('OrderPanel — clearing the member', () => {
  it('severity 1 when lines keep their member price', () => {
    const memberPriced = { ...guinness, unit_price: 6.5, subtotal: 19.5, member_price_applied: true }
    renderPanel({ orderItems: [memberPriced, lager], activeMember: alice })
    fireEvent.click(screen.getByRole('button', { name: 'Clear member' }))
    expect(useTillStore.getState().activeMember).toBeNull()
    // nothing is repriced — exactly as before
    expect(items()).toEqual([memberPriced, lager])
    expect(logEvent.mock.calls).toEqual([
      ['cart.member_cleared', { member_id: 'm1', member_name: 'Alice', lines_at_member_price: 1 }, { severity: 1 }],
    ])
  })

  it('severity 0 when no line carries a member price', () => {
    renderPanel({ orderItems: [lager], activeMember: alice })
    fireEvent.click(screen.getByRole('button', { name: 'Clear member' }))
    expect(logEvent.mock.calls).toEqual([
      ['cart.member_cleared', { member_id: 'm1', member_name: 'Alice', lines_at_member_price: 0 }, { severity: 0 }],
    ])
  })

  it('notes when members-only mode explains the member prices', () => {
    const memberPriced = { ...guinness, member_price_applied: true }
    renderPanel({ orderItems: [memberPriced], activeMember: alice, membersOnlyMode: true })
    fireEvent.click(screen.getByRole('button', { name: 'Clear member' }))
    expect(logEvent.mock.calls[0][1]).toEqual({
      member_id: 'm1', member_name: 'Alice', lines_at_member_price: 1, members_only_mode: true,
    })
  })

  it('never logs the member record itself', () => {
    renderPanel({ orderItems: [lager], activeMember: { ...alice, pin_hash: 'SECRET', phone: '07700 900123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Clear member' }))
    const logged = JSON.stringify(logEvent.mock.calls)
    expect(logged).not.toContain('SECRET')
    expect(logged).not.toContain('07700')
  })
})

describe('OrderPanel — tab amount', () => {
  it('logs a tap on the blurred tab amount, and still reveals it', () => {
    renderPanel({ orderItems: [lager], activeMember: alice })
    fireEvent.click(screen.getByRole('button', { name: /tap to reveal tab amount/i }))
    expect(screen.getByRole('button', { name: /tab amount visible/i })).toBeInTheDocument()
    expect(logEvent.mock.calls).toEqual([
      ['tab.amount_revealed', { member_id: 'm1' }],
    ])
  })
})

describe('OrderPanel — checkout is untouched', () => {
  it('Card still checks out on one tap and logs nothing itself', async () => {
    const { onCheckout } = renderPanel({ orderItems: [lager] })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /card/i })) })
    expect(onCheckout).toHaveBeenCalledWith('card')
    expect(logEvent).not.toHaveBeenCalled()
  })

  it('Cash opens the tender screen; the tender is logged on Confirm, not before', async () => {
    const { onCheckout } = renderPanel({ orderItems: [lager] })
    fireEvent.click(screen.getByRole('button', { name: /cash/i }))
    expect(onCheckout).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '£10' }))
    expect(logEvent).not.toHaveBeenCalled()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /confirm/i })) })
    expect(onCheckout).toHaveBeenCalledWith('cash')
    expect(logEvent.mock.calls).toEqual([
      ['sale.cash_tendered', { total: 5, tendered: 10, change: 5 }],
    ])
  })
})

describe('OrderPanel tab standing', () => {
  const item = { product_id: 'p1', name: 'Guinness', quantity: 1, unit_price: 5.5, subtotal: 5.5 }
  const member = { id: 'm1', name: 'Alice', tab_balance: 20 }

  beforeEach(() => useTillStore.setState({ orderItems: [item], activeMember: null, activeMemberTab: null, membersOnlyMode: false }))

  it('lets a member in good standing pay by tab', () => {
    useTillStore.setState({ activeMember: member })
    render(<OrderPanel onCheckout={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Tab' })).toBeEnabled()
    expect(screen.queryByText(/tab blocked/i)).not.toBeInTheDocument()
  })

  it('disables Tab and says why when the tab is blocked', () => {
    useTillStore.setState({ activeMember: { ...member, tab_blocked: true } })
    render(<OrderPanel onCheckout={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Tab' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Card' })).toBeEnabled()
    expect(screen.getByText(/tab blocked — cash or card only/i)).toBeInTheDocument()
  })

  it('warns when the tab is overdue but still allows it', () => {
    useTillStore.setState({ activeMember: member, activeMemberTab: { days: 23, overdue: true } })
    render(<OrderPanel onCheckout={vi.fn()} />)
    expect(screen.getByText('No tab payment for 23 days')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tab' })).toBeEnabled()
  })
})
