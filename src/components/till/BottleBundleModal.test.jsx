import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import BottleBundleModal from './BottleBundleModal'
import { useTillStore } from '../../stores/tillStore'
import { logEvent } from '../../lib/audit/log'

vi.mock('../../lib/audit/log', () => ({ logEvent: vi.fn() }))

// A products list mirroring the live Bottle category, including the look-alikes
// the deal must NOT include.
const products = [
  { id: 'sm',     name: 'San Miguel',        category: 'bottle',  standard_price: 5.25, member_price: 4.75 },
  { id: 'sm0',    name: 'San Miguel 0%',     category: 'bottle',  standard_price: 4.50, member_price: 4.10 },
  { id: 'cbb',    name: 'Carlsberg (Bottle)', category: 'bottle', standard_price: 5.25, member_price: 4.75 },
  { id: 'cb0',    name: 'Carlsberg 0%',      category: 'bottle',  standard_price: 4.50, member_price: 4.10 },
  { id: 'bw',     name: 'Budweiser',         category: 'bottle',  standard_price: 5.25, member_price: 4.75 },
  { id: 'becks',  name: 'Becks',             category: 'bottle',  standard_price: 5.25, member_price: 4.75 },
  { id: 'cbd',    name: 'Carlsberg',         category: 'draught', standard_price: 6.00, member_price: 5.40 },
]

beforeEach(() => {
  useTillStore.setState({ orderItems: [], activeMember: null, membersOnlyMode: false })
  logEvent.mockClear()
})

describe('BottleBundleModal eligibility', () => {
  it('shows exactly the three eligible bottles', () => {
    render(<BottleBundleModal products={products} onClose={vi.fn()} />)
    expect(screen.getByText('San Miguel')).toBeInTheDocument()
    expect(screen.getByText('Carlsberg (Bottle)')).toBeInTheDocument()
    expect(screen.getByText('Budweiser')).toBeInTheDocument()
  })

  it('excludes the 0% look-alikes, other bottles, and the draught Carlsberg', () => {
    render(<BottleBundleModal products={products} onClose={vi.fn()} />)
    expect(screen.queryByText('San Miguel 0%')).not.toBeInTheDocument()
    expect(screen.queryByText('Carlsberg 0%')).not.toBeInTheDocument()
    expect(screen.queryByText('Becks')).not.toBeInTheDocument()
    // Exact-match: the draught "Carlsberg" tile must not render (only the bottle).
    expect(screen.queryByText('Carlsberg')).not.toBeInTheDocument()
  })
})

describe('BottleBundleModal deal flow', () => {
  it('reaches "price of 4" (£21.00) once five bottles are picked and adds them on confirm', () => {
    const onClose = vi.fn()
    render(<BottleBundleModal products={products} onClose={onClose} />)

    const tile = screen.getByRole('button', { name: /San Miguel/ })
    for (let i = 0; i < 5; i++) fireEvent.click(tile)

    // Footer/label shows the charged total, which equals the price of 4.
    expect(screen.getByRole('button', { name: /Add to Order — £21\.00/ })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: /Add to Order — £21\.00/ }))
    expect(onClose).toHaveBeenCalled()
    expect(useTillStore.getState().getTotal()).toBeCloseTo(21.00, 2)
  })

  it('shows member prices on the tiles and charges price-of-4 off member price for a member', () => {
    useTillStore.setState({ activeMember: { id: 'm', name: 'M' } })
    render(<BottleBundleModal products={products} onClose={vi.fn()} />)

    // Member bottle price is £4.75 → tiles reference the member price, not £5.25.
    expect(screen.getAllByText(/£4\.75 normally/).length).toBeGreaterThanOrEqual(3)
    expect(screen.queryByText(/£5\.25 normally/)).not.toBeInTheDocument()

    const tile = screen.getByRole('button', { name: /San Miguel/ })
    for (let i = 0; i < 5; i++) fireEvent.click(tile)
    // price of 4 off member price: 4 × £4.75 = £19.00
    expect(screen.getByRole('button', { name: /Add to Order — £19\.00/ })).toBeEnabled()
  })
})

describe('BottleBundleModal audit', () => {
  it('logs cart.bundle_added once the bottles are on the order', () => {
    render(<BottleBundleModal products={products} onClose={vi.fn()} />)
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button', { name: /San Miguel/ }))
    for (let i = 0; i < 2; i++) fireEvent.click(screen.getByRole('button', { name: /Budweiser/ }))
    expect(logEvent).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /Add to Order — £21\.00/ }))
    expect(useTillStore.getState().orderItems).toHaveLength(2)
    expect(logEvent.mock.calls).toEqual([
      ['cart.bundle_added', {
        bundle: 'bottles_5_for_4',
        lines: 2,
        value: 21,
        items: [{ product: 'San Miguel', quantity: 3 }, { product: 'Budweiser', quantity: 2 }],
        member_prices: false,
      }],
    ])
  })

  it('says when the deal was worked out from member prices', () => {
    useTillStore.setState({ activeMember: { id: 'm', name: 'M' } })
    render(<BottleBundleModal products={products} onClose={vi.fn()} />)
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByRole('button', { name: /San Miguel/ }))
    fireEvent.click(screen.getByRole('button', { name: /Add to Order — £19\.00/ }))
    expect(logEvent.mock.calls[0][1]).toMatchObject({ value: 19, member_prices: true })
  })

  it('logs nothing when the modal is closed without adding', () => {
    const onClose = vi.fn()
    render(<BottleBundleModal products={products} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /San Miguel/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
    expect(logEvent).not.toHaveBeenCalled()
  })
})
