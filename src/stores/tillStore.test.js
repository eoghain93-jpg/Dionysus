import { describe, it, expect, beforeEach } from 'vitest'
import { useTillStore } from './tillStore'

const mockProduct = {
  id: 'prod-1',
  name: 'Guinness',
  standard_price: 5.50,
  member_price: 4.50,
}

beforeEach(() => {
  useTillStore.setState({ orderItems: [], activeMember: null })
})

describe('tillStore', () => {
  it('adds a product to order at standard price', () => {
    useTillStore.getState().addItem(mockProduct)
    const { orderItems } = useTillStore.getState()
    expect(orderItems).toHaveLength(1)
    expect(orderItems[0].unit_price).toBe(5.50)
    expect(orderItems[0].member_price_applied).toBe(false)
  })

  it('applies member price when member is active', () => {
    useTillStore.setState({ activeMember: { id: 'mem-1', name: 'Test' } })
    useTillStore.getState().addItem(mockProduct)
    const { orderItems } = useTillStore.getState()
    expect(orderItems[0].unit_price).toBe(4.50)
    expect(orderItems[0].member_price_applied).toBe(true)
  })

  it('increments quantity when same product added twice', () => {
    useTillStore.getState().addItem(mockProduct)
    useTillStore.getState().addItem(mockProduct)
    const { orderItems } = useTillStore.getState()
    expect(orderItems).toHaveLength(1)
    expect(orderItems[0].quantity).toBe(2)
  })

  it('calculates total correctly', () => {
    useTillStore.getState().addItem(mockProduct)
    useTillStore.getState().addItem(mockProduct)
    expect(useTillStore.getState().getTotal()).toBe(11.00)
  })

  it('removes an item', () => {
    useTillStore.getState().addItem(mockProduct)
    useTillStore.getState().removeItem('prod-1')
    expect(useTillStore.getState().orderItems).toHaveLength(0)
  })

  it('clears the order', () => {
    useTillStore.getState().addItem(mockProduct)
    useTillStore.getState().clearOrder()
    expect(useTillStore.getState().orderItems).toHaveLength(0)
  })
})
