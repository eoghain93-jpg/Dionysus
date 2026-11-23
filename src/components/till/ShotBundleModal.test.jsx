import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ShotBundleModal from './ShotBundleModal'
import { useTillStore } from '../../stores/tillStore'
import { logEvent } from '../../lib/audit/log'

vi.mock('../../lib/audit/log', () => ({ logEvent: vi.fn() }))

const products = [
  { id: 'sam', name: 'Sambuca',  category: 'spirit',  standard_price: 4.00, member_price: 3.60 },
  { id: 'fir', name: 'Fireball', category: 'spirit',  standard_price: 4.20, member_price: 3.80 },
  { id: 'vod', name: 'Vodka',    category: 'spirit',  standard_price: 4.00, member_price: 3.60 },
  { id: 'gui', name: 'Guinness', category: 'draught', standard_price: 7.40, member_price: 6.50 },
]

beforeEach(() => {
  useTillStore.setState({ orderItems: [], activeMember: null, membersOnlyMode: false })
  vi.clearAllMocks()
})

describe('ShotBundleModal audit', () => {
  it('logs cart.bundle_added once the four shots are on the order', () => {
    const onClose = vi.fn()
    render(<ShotBundleModal products={products} onClose={onClose} />)
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button', { name: /Sambuca/ }))
    fireEvent.click(screen.getByRole('button', { name: /Fireball/ }))
    expect(logEvent).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /add to order/i }))
    expect(onClose).toHaveBeenCalled()
    expect(useTillStore.getState().getTotal()).toBeCloseTo(10, 2)
    expect(logEvent.mock.calls).toEqual([
      ['cart.bundle_added', {
        bundle: 'shots_4_for_10',
        lines: 2,
        value: 10,
        items: [{ product: 'Sambuca', quantity: 3 }, { product: 'Fireball', quantity: 1 }],
      }],
    ])
  })

  it('logs nothing when the modal is cancelled', () => {
    const onClose = vi.fn()
    render(<ShotBundleModal products={products} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /Sambuca/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
    expect(useTillStore.getState().orderItems).toEqual([])
    expect(logEvent).not.toHaveBeenCalled()
  })
})
