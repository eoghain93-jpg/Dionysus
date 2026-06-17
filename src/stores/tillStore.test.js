import { describe, it, expect, beforeEach } from 'vitest'
import { vi } from 'vitest'
import { useTillStore, bottleBundlePricing } from './tillStore'

const mockProduct = {
  id: 'prod-1',
  name: 'Guinness',
  standard_price: 5.50,
  member_price: 4.50,
}

beforeEach(() => {
  useTillStore.setState({ orderItems: [], activeMember: null, membersOnlyMode: false })
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

  it('applies member price when membersOnlyMode is on and no individual member', () => {
    useTillStore.setState({ membersOnlyMode: true, activeMember: null })
    useTillStore.getState().addItem(mockProduct)
    const { orderItems } = useTillStore.getState()
    expect(orderItems[0].unit_price).toBe(4.50)
    expect(orderItems[0].member_price_applied).toBe(true)
  })

  it('uses standard price when membersOnlyMode is off and no member active', () => {
    useTillStore.setState({ membersOnlyMode: false, activeMember: null })
    useTillStore.getState().addItem(mockProduct)
    const { orderItems } = useTillStore.getState()
    expect(orderItems[0].unit_price).toBe(5.50)
    expect(orderItems[0].member_price_applied).toBe(false)
  })

  it('setMembersOnlyMode toggles the flag', () => {
    useTillStore.getState().setMembersOnlyMode(true)
    expect(useTillStore.getState().membersOnlyMode).toBe(true)
    useTillStore.getState().setMembersOnlyMode(false)
    expect(useTillStore.getState().membersOnlyMode).toBe(false)
  })

  describe('addBundleItems', () => {
    const vodka  = { id: 'spirit-vodka',  name: 'Vodka',  category: 'spirit', standard_price: 4.50, member_price: 4.00 }
    const gin    = { id: 'spirit-gin',    name: 'Gin',    category: 'spirit', standard_price: 4.50, member_price: 4.00 }
    const rum    = { id: 'spirit-rum',    name: 'Rum',    category: 'spirit', standard_price: 4.50, member_price: 4.00 }
    const whisky = { id: 'spirit-whisky', name: 'Whisky', category: 'spirit', standard_price: 5.00, member_price: 4.50 }

    it('adds 4 distinct spirits at £2.50 each, totalling £10', () => {
      useTillStore.getState().addBundleItems([vodka, gin, rum, whisky], 10.00)
      const { orderItems } = useTillStore.getState()
      expect(orderItems).toHaveLength(4)
      expect(orderItems.every(i => i.unit_price === 2.50)).toBe(true)
      expect(orderItems.every(i => i.bundle_price_applied === true)).toBe(true)
      expect(useTillStore.getState().getTotal()).toBe(10.00)
    })

    it('collapses duplicates in the bundle into a single line with quantity', () => {
      useTillStore.getState().addBundleItems([vodka, vodka, vodka, vodka], 10.00)
      const { orderItems } = useTillStore.getState()
      expect(orderItems).toHaveLength(1)
      expect(orderItems[0].quantity).toBe(4)
      expect(orderItems[0].unit_price).toBe(2.50)
      expect(orderItems[0].subtotal).toBe(10.00)
    })

    it('does not merge with existing standard-price items for the same product', () => {
      // Customer adds a vodka at standard, then opens the bundle and adds 4 more vodkas
      useTillStore.getState().addItem(vodka)
      useTillStore.getState().addBundleItems([vodka, vodka, vodka, vodka], 10.00)
      const { orderItems } = useTillStore.getState()
      expect(orderItems).toHaveLength(2)
      const standard = orderItems.find(i => i.unit_price === 4.50)
      const bundle   = orderItems.find(i => i.unit_price === 2.50)
      expect(standard.quantity).toBe(1)
      expect(bundle.quantity).toBe(4)
      expect(useTillStore.getState().getTotal()).toBe(14.50)
    })

    it('marks bundle items so they are NOT flagged as member or promo prices', () => {
      useTillStore.setState({ activeMember: { id: 'm1', name: 'Test' } })
      useTillStore.getState().addBundleItems([vodka, gin, rum, whisky], 10.00)
      const items = useTillStore.getState().orderItems
      expect(items.every(i => i.bundle_price_applied === true)).toBe(true)
      expect(items.every(i => i.member_price_applied === false)).toBe(true)
      expect(items.every(i => i.promo_price_applied === false)).toBe(true)
    })

    it('is a no-op when product list is empty', () => {
      useTillStore.getState().addBundleItems([], 10.00)
      expect(useTillStore.getState().orderItems).toHaveLength(0)
    })
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

  // ---------------------------------------------------------------------------
  // Bottle 5-for-4 bundle (buy 5 pay for 4: the cheapest of the 5 is free,
  // spread evenly across the lines so there is no editable £0 freebie line)
  // ---------------------------------------------------------------------------
  describe('addBottleBundle', () => {
    const sanMiguel = { id: 'btl-sm',  name: 'San Miguel',       category: 'bottle', standard_price: 5.25, member_price: 4.75 }
    const carlsberg = { id: 'btl-cb',  name: 'Carlsberg (Bottle)', category: 'bottle', standard_price: 5.25, member_price: 4.75 }
    const budweiser = { id: 'btl-bw',  name: 'Budweiser',        category: 'bottle', standard_price: 5.25, member_price: 4.75 }

    it('charges the price of 4 for 5 identical bottles (£21.00 for 5 × £5.25)', () => {
      useTillStore.getState().addBottleBundle([sanMiguel, sanMiguel, sanMiguel, sanMiguel, sanMiguel])
      expect(useTillStore.getState().getTotal()).toBeCloseTo(21.00, 2)
    })

    it('collapses identical bottles into one line with the spread unit price', () => {
      useTillStore.getState().addBottleBundle([sanMiguel, sanMiguel, sanMiguel, sanMiguel, sanMiguel])
      const { orderItems } = useTillStore.getState()
      expect(orderItems).toHaveLength(1)
      expect(orderItems[0].quantity).toBe(5)
      expect(orderItems[0].unit_price).toBeCloseTo(4.20, 2) // £21 / 5
      expect(orderItems[0].subtotal).toBeCloseTo(21.00, 2)
    })

    it('handles a mix across the three brands and still charges price of 4', () => {
      useTillStore.getState().addBottleBundle([sanMiguel, sanMiguel, budweiser, budweiser, carlsberg])
      const { orderItems } = useTillStore.getState()
      expect(orderItems).toHaveLength(3)
      expect(orderItems.reduce((s, i) => s + i.quantity, 0)).toBe(5)
      expect(useTillStore.getState().getTotal()).toBeCloseTo(21.00, 2)
    })

    it('flags lines as bundle, never member/promo, and gives each a unique line_id', () => {
      useTillStore.getState().addBottleBundle([sanMiguel, sanMiguel, budweiser, budweiser, carlsberg])
      const { orderItems } = useTillStore.getState()
      expect(orderItems.every(i => i.bundle_price_applied === true)).toBe(true)
      expect(orderItems.every(i => i.member_price_applied === false)).toBe(true)
      expect(orderItems.every(i => i.promo_price_applied === false)).toBe(true)
      const ids = orderItems.map(i => i.line_id)
      expect(ids.every(Boolean)).toBe(true)
      expect(new Set(ids).size).toBe(ids.length) // all unique
    })

    it('running the deal twice for the same brand keeps two independently-keyed lines', () => {
      useTillStore.getState().addBottleBundle([sanMiguel, sanMiguel, sanMiguel, sanMiguel, sanMiguel])
      useTillStore.getState().addBottleBundle([sanMiguel, sanMiguel, sanMiguel, sanMiguel, sanMiguel])
      const { orderItems } = useTillStore.getState()
      expect(orderItems).toHaveLength(2)
      const ids = orderItems.map(i => i.line_id)
      expect(new Set(ids).size).toBe(2)
      expect(useTillStore.getState().getTotal()).toBeCloseTo(42.00, 2)
    })

    it('removeItem on one bundle line leaves the other bundle line intact', () => {
      useTillStore.getState().addBottleBundle([sanMiguel, sanMiguel, sanMiguel, sanMiguel, sanMiguel])
      useTillStore.getState().addBottleBundle([sanMiguel, sanMiguel, sanMiguel, sanMiguel, sanMiguel])
      const first = useTillStore.getState().orderItems[0]
      useTillStore.getState().removeItem(first.line_id)
      const { orderItems } = useTillStore.getState()
      expect(orderItems).toHaveLength(1)
      expect(useTillStore.getState().getTotal()).toBeCloseTo(21.00, 2)
    })

    it('does not merge with a plain line for the same product', () => {
      useTillStore.getState().addItem(sanMiguel)
      useTillStore.getState().addBottleBundle([sanMiguel, sanMiguel, sanMiguel, sanMiguel, sanMiguel])
      const { orderItems } = useTillStore.getState()
      expect(orderItems).toHaveLength(2)
    })

    it('is a no-op when the selection is empty', () => {
      useTillStore.getState().addBottleBundle([])
      expect(useTillStore.getState().orderItems).toHaveLength(0)
    })

    it('the cart total always equals the previewed deal total (preview == charge)', () => {
      // Tonight's lineup: all £5.25 → exact £21.00
      const five = [sanMiguel, sanMiguel, budweiser, budweiser, carlsberg]
      useTillStore.getState().addBottleBundle(five)
      expect(useTillStore.getState().getTotal()).toBeCloseTo(bottleBundlePricing(five).total, 2)

      // And the invariant holds for a hypothetical mixed-price lineup too, so a
      // future edit to the eligible list can't desync the label from the charge.
      useTillStore.setState({ orderItems: [] })
      const odd = [
        { id: 'a', name: 'A', category: 'bottle', standard_price: 3.33, member_price: 3.0 },
        { id: 'a', name: 'A', category: 'bottle', standard_price: 3.33, member_price: 3.0 },
        { id: 'a', name: 'A', category: 'bottle', standard_price: 3.33, member_price: 3.0 },
        { id: 'a', name: 'A', category: 'bottle', standard_price: 3.33, member_price: 3.0 },
        { id: 'a', name: 'A', category: 'bottle', standard_price: 3.33, member_price: 3.0 },
      ]
      useTillStore.getState().addBottleBundle(odd)
      expect(useTillStore.getState().getTotal()).toBeCloseTo(bottleBundlePricing(odd).total, 2)
    })

    it('uses MEMBER prices for the deal when a member is on the sale', () => {
      // member_price 4.75 each → price of 4 = 4 × 4.75 = £19.00 (vs £21.00 standard)
      useTillStore.setState({ activeMember: { id: 'm', name: 'M' } })
      useTillStore.getState().addBottleBundle([sanMiguel, sanMiguel, sanMiguel, sanMiguel, sanMiguel])
      expect(useTillStore.getState().getTotal()).toBeCloseTo(19.00, 2)
    })

    it('uses member prices under members-only mode too', () => {
      useTillStore.setState({ membersOnlyMode: true })
      useTillStore.getState().addBottleBundle([sanMiguel, sanMiguel, sanMiguel, sanMiguel, sanMiguel])
      expect(useTillStore.getState().getTotal()).toBeCloseTo(19.00, 2)
    })
  })

  describe('bottleBundlePricing (pure)', () => {
    const b = (id, price) => ({ id, name: id, category: 'bottle', standard_price: price, member_price: price })

    it('honours member prices when useMemberPrice is set', () => {
      const sel = Array.from({ length: 5 }, () => ({
        id: 'x', name: 'x', category: 'bottle', standard_price: 5.25, member_price: 4.75,
      }))
      expect(bottleBundlePricing(sel, true).total).toBeCloseTo(19.00, 2)
      expect(bottleBundlePricing(sel, false).total).toBeCloseTo(21.00, 2)
    })

    it('charges the price of 4 for 5 equal bottles', () => {
      const r = bottleBundlePricing([b('x', 5.25), b('x', 5.25), b('x', 5.25), b('x', 5.25), b('x', 5.25)])
      expect(r.unitPrice).toBeCloseTo(4.20, 2)
      expect(r.total).toBeCloseTo(21.00, 2)
    })

    it('total is exactly unitPrice × count (no preview/charge drift)', () => {
      const sel = [b('x', 4.99), b('x', 4.99), b('x', 4.99), b('y', 2.50), b('y', 2.50)]
      const r = bottleBundlePricing(sel)
      expect(r.total).toBeCloseTo(Number((r.unitPrice * sel.length).toFixed(2)), 2)
    })

    it('returns zero for an empty selection', () => {
      expect(bottleBundlePricing([])).toEqual({ unitPrice: 0, total: 0 })
    })
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
  // Staff drink credits ("one in for yourself")
  // ---------------------------------------------------------------------------
  describe('addStaffCreditItem', () => {
    const staff = { id: 'staff-1', name: 'Dave O Brien' }

    it('adds a line flagged for the staff member at standard price', () => {
      useTillStore.getState().addStaffCreditItem(mockProduct, staff)
      const { orderItems } = useTillStore.getState()
      expect(orderItems).toHaveLength(1)
      expect(orderItems[0].staff_credit_for).toBe('staff-1')
      expect(orderItems[0].staff_credit_name).toBe('Dave O Brien')
      expect(orderItems[0].unit_price).toBe(5.50)
    })

    it('charges standard price even when a member is active (tips are full price)', () => {
      useTillStore.setState({ activeMember: { id: 'mem-1', name: 'Test' } })
      useTillStore.getState().addStaffCreditItem(mockProduct, staff)
      const { orderItems } = useTillStore.getState()
      expect(orderItems[0].unit_price).toBe(5.50)
      expect(orderItems[0].member_price_applied).toBe(false)
    })

    it('never merges with a regular line for the same product', () => {
      useTillStore.getState().addItem(mockProduct)
      useTillStore.getState().addStaffCreditItem(mockProduct, staff)
      const { orderItems } = useTillStore.getState()
      expect(orderItems).toHaveLength(2)
    })

    it('a grid tap AFTER a staff credit creates a separate regular line (never corrupts the credit)', () => {
      useTillStore.getState().addStaffCreditItem(mockProduct, staff)
      useTillStore.getState().addItem(mockProduct)
      const { orderItems } = useTillStore.getState()
      expect(orderItems).toHaveLength(2)
      const credit = orderItems.find(i => i.staff_credit_for)
      const regular = orderItems.find(i => !i.staff_credit_for)
      expect(credit.quantity).toBe(1)
      expect(regular.quantity).toBe(1)
    })

    it('a grid tap increments ONLY the plain line when both kinds are in the basket', () => {
      useTillStore.getState().addItem(mockProduct)
      useTillStore.getState().addStaffCreditItem(mockProduct, staff)
      useTillStore.getState().addItem(mockProduct)
      const { orderItems } = useTillStore.getState()
      const credit = orderItems.find(i => i.staff_credit_for)
      const regular = orderItems.find(i => !i.staff_credit_for)
      expect(regular.quantity).toBe(2)
      expect(credit.quantity).toBe(1)
      expect(credit.subtotal).toBe(5.50)
    })

    it('merges repeat credits for the same product AND same staff member', () => {
      useTillStore.getState().addStaffCreditItem(mockProduct, staff)
      useTillStore.getState().addStaffCreditItem(mockProduct, staff)
      const { orderItems } = useTillStore.getState()
      expect(orderItems).toHaveLength(1)
      expect(orderItems[0].quantity).toBe(2)
      expect(orderItems[0].subtotal).toBe(11.00)
    })

    it('keeps credits for different staff members as separate lines', () => {
      useTillStore.getState().addStaffCreditItem(mockProduct, staff)
      useTillStore.getState().addStaffCreditItem(mockProduct, { id: 'staff-2', name: 'Eve' })
      expect(useTillStore.getState().orderItems).toHaveLength(2)
    })

    it('removing a credit line leaves the regular line for the same product intact', () => {
      useTillStore.getState().addItem(mockProduct)
      useTillStore.getState().addStaffCreditItem(mockProduct, staff)
      const credit = useTillStore.getState().orderItems.find(i => i.staff_credit_for)
      useTillStore.getState().removeItem(credit.line_id)
      const { orderItems } = useTillStore.getState()
      expect(orderItems).toHaveLength(1)
      expect(orderItems[0].staff_credit_for).toBeUndefined()
    })

    it('updateQuantity on a credit line does not touch the regular line', () => {
      useTillStore.getState().addItem(mockProduct)
      useTillStore.getState().addStaffCreditItem(mockProduct, staff)
      const credit = useTillStore.getState().orderItems.find(i => i.staff_credit_for)
      useTillStore.getState().updateQuantity(credit.line_id, 3)
      const { orderItems } = useTillStore.getState()
      const regular = orderItems.find(i => !i.staff_credit_for)
      const updated = orderItems.find(i => i.staff_credit_for)
      expect(regular.quantity).toBe(1)
      expect(updated.quantity).toBe(3)
      expect(updated.subtotal).toBe(16.50)
    })
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

    it('stacks a percentage promo as the same % off the member price', () => {
      // standard 5.50, member 4.50, promo 20% → member gets 20% off THEIR
      // price: 4.50 × 0.80 = 3.60 (not a flat £-amount off).
      useTillStore.setState({
        activeMember: { id: 'mem-1', name: 'Test' },
        activePromos: mockPromos,
      })
      const mondayEvening = new Date('2026-03-30T18:00:00')
      useTillStore.getState().addItem(mockProduct, mondayEvening)
      const { orderItems } = useTillStore.getState()
      expect(orderItems[0].unit_price).toBeCloseTo(3.60, 2)
      expect(orderItems[0].promo_price_applied).toBe(true)
    })

    it('non-member gets the plain promo price off standard', () => {
      useTillStore.setState({ activeMember: null, activePromos: mockPromos })
      const mondayEvening = new Date('2026-03-30T18:00:00')
      useTillStore.getState().addItem(mockProduct, mondayEvening)
      const { orderItems } = useTillStore.getState()
      expect(orderItems[0].unit_price).toBeCloseTo(4.40, 2) // 20% off 5.50
      expect(orderItems[0].promo_price_applied).toBe(true)
    })

    it('"50p off" fixed_price promo: non-member −50p off standard, member −50p off member price', () => {
      // Mirrors tonight: Guinness standard 7.40, member 6.80, promo fixed 6.90.
      const guinness = { id: 'prod-1', name: 'Guinness', standard_price: 7.40, member_price: 6.80 }
      const fiftyP = [{
        id: 'promo-50p', name: '50p Off Pints', active: true,
        start_time: null, end_time: null, days_of_week: null,
        start_date: null, end_date: null,
        promotion_items: [{
          id: 'pi', promotion_id: 'promo-50p', product_id: 'prod-1',
          discount_type: 'fixed_price', discount_value: 6.90,
        }],
        promotion_categories: [],
      }]

      // Non-member → standard − 50p = 6.90
      useTillStore.setState({ activeMember: null, activePromos: fiftyP })
      useTillStore.getState().addItem(guinness)
      expect(useTillStore.getState().orderItems[0].unit_price).toBeCloseTo(6.90, 2)

      // Member → member − 50p = 6.30
      useTillStore.setState({ orderItems: [], activeMember: { id: 'm', name: 'M' }, activePromos: fiftyP })
      useTillStore.getState().addItem(guinness)
      expect(useTillStore.getState().orderItems[0].unit_price).toBeCloseTo(6.30, 2)
      expect(useTillStore.getState().orderItems[0].promo_price_applied).toBe(true)
    })

    it('loadPromos stores fetched promos in activePromos state', async () => {
      const mockFetch = vi.fn().mockResolvedValue([...mockPromos])
      useTillStore.setState({ activePromos: [] })
      await useTillStore.getState().loadPromos(mockFetch)
      expect(useTillStore.getState().activePromos).toEqual(mockPromos)
    })
  })
})
