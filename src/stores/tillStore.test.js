import { describe, it, expect, beforeEach } from 'vitest'
import { vi } from 'vitest'
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

  // ---------------------------------------------------------------------------
  // Promo pricing in addItem
  // ---------------------------------------------------------------------------

  describe('promo pricing', () => {
    const mockPromos = [
      {
        id: 'promo-happy',
        name: 'Happy Hour',
        active: true,
        start_time: '17:00',
        end_time: '19:00',
        days_of_week: null,
        start_date: null,
        end_date: null,
        promotion_items: [
          {
            id: 'pi-1',
            promotion_id: 'promo-happy',
            product_id: 'prod-1',
            discount_type: 'percentage',
            discount_value: 20,
          },
        ],
      },
    ]

    beforeEach(() => {
      useTillStore.setState({ orderItems: [], activeMember: null, activePromos: [] })
    })

    it('applies promo price when a matching promo is active and now is within window', () => {
      useTillStore.setState({ activePromos: mockPromos })
      // Monday 18:00 — inside happy hour window; 20% off 5.50 = 4.40
      const mondayEvening = new Date('2026-03-30T18:00:00')
      useTillStore.getState().addItem(mockProduct, mondayEvening)
      const { orderItems } = useTillStore.getState()
      expect(orderItems[0].unit_price).toBe(4.40)
      expect(orderItems[0].promo_price_applied).toBe(true)
    })

    it('does not apply promo price when outside the time window', () => {
      useTillStore.setState({ activePromos: mockPromos })
      const mondayMorning = new Date('2026-03-30T10:00:00')
      useTillStore.getState().addItem(mockProduct, mondayMorning)
      const { orderItems } = useTillStore.getState()
      expect(orderItems[0].unit_price).toBe(5.50)
      expect(orderItems[0].promo_price_applied).toBe(false)
    })

    it('does not apply promo price when activePromos is empty', () => {
      useTillStore.setState({ activePromos: [] })
      const mondayEvening = new Date('2026-03-30T18:00:00')
      useTillStore.getState().addItem(mockProduct, mondayEvening)
      expect(useTillStore.getState().orderItems[0].unit_price).toBe(5.50)
    })

    it('member price beats promo price when member price is lower', () => {
      // member price £3.50 < promo 20% off 5.50 = £4.40 — member wins
      const cheapMemberProduct = {
        id: 'prod-1',
        name: 'Guinness',
        standard_price: 5.50,
        member_price: 3.50,
      }
      useTillStore.setState({
        activeMember: { id: 'mem-1', name: 'Test' },
        activePromos: mockPromos,
      })
      const mondayEvening = new Date('2026-03-30T18:00:00')
      useTillStore.getState().addItem(cheapMemberProduct, mondayEvening)
      const { orderItems } = useTillStore.getState()
      expect(orderItems[0].unit_price).toBe(3.50)
      expect(orderItems[0].member_price_applied).toBe(true)
    })

    it('promo price beats member price when promo is lower', () => {
      // standard_price 5.50, member_price 4.50, promo 20% = 4.40 — promo wins
      useTillStore.setState({
        activeMember: { id: 'mem-1', name: 'Test' },
        activePromos: mockPromos,
      })
      const mondayEvening = new Date('2026-03-30T18:00:00')
      useTillStore.getState().addItem(mockProduct, mondayEvening)
      const { orderItems } = useTillStore.getState()
      expect(orderItems[0].unit_price).toBe(4.40)
      expect(orderItems[0].promo_price_applied).toBe(true)
    })

    it('loadPromos stores fetched promos in activePromos state', async () => {
      const mockFetch = vi.fn().mockResolvedValue([...mockPromos])
      useTillStore.setState({ activePromos: [] })
      await useTillStore.getState().loadPromos(mockFetch)
      expect(useTillStore.getState().activePromos).toEqual(mockPromos)
    })
  })
})
