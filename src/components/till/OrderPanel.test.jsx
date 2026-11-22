import { render, screen } from '@testing-library/react'
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
