import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import OrderPanel from './OrderPanel'
import { useTillStore } from '../../stores/tillStore'

const item = { product_id: 'p1', name: 'Guinness', quantity: 1, unit_price: 5.5, subtotal: 5.5 }
const member = { id: 'm1', name: 'Alice', tab_balance: 20 }

beforeEach(() => useTillStore.setState({ orderItems: [item], activeMember: null, activeMemberTab: null }))

describe('OrderPanel tab standing', () => {
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

describe('OrderPanel order controls', () => {
  beforeEach(() => useTillStore.setState({ parkedOrders: [], parkSeq: 1, lastSale: null }))

  it('needs a second tap to void the order', () => {
    render(<OrderPanel onCheckout={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Void' }))
    expect(useTillStore.getState().orderItems).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm void' }))
    expect(useTillStore.getState().orderItems).toHaveLength(0)
  })

  it('parks the order and offers it back as a chip', () => {
    render(<OrderPanel onCheckout={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Park' }))
    expect(useTillStore.getState().orderItems).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: /resume parked order order 1/i }))
    expect(useTillStore.getState().orderItems).toMatchObject([{ product_id: 'p1' }])
    expect(useTillStore.getState().parkedOrders).toHaveLength(0)
  })

  it('offers the member\'s usual and the last sale again', () => {
    const onAddUsual = vi.fn()
    const onSameAgain = vi.fn()
    useTillStore.setState({
      orderItems: [], activeMember: member,
      lastSale: { items: [item], member: null, total: 5.5, paymentMethod: 'card' },
    })
    render(
      <OrderPanel
        onCheckout={vi.fn()}
        usual={[{ product: { id: 'p1', name: 'Guinness' }, quantity: 2 }]}
        onAddUsual={onAddUsual}
        onSameAgain={onSameAgain}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /2 × Guinness/ }))
    expect(onAddUsual).toHaveBeenCalled()
    expect(screen.getByText(/£5\.50 by card/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Same again' }))
    expect(onSameAgain).toHaveBeenCalled()
  })
})
