// src/stores/tillStore.js
import { create } from 'zustand'
import { getPromoPrice } from '../lib/promos'

export const useTillStore = create((set, get) => ({
  orderItems: [],
  activeMember: null,
  activePromos: [],
  // Event mode: when true, every sale gets member pricing without needing
  // an individual member identified. Used for members-only events (sport
  // days etc.) where the door staff have already verified everyone in the
  // building is a member. Auto-reset on staff change in TillPage.
  membersOnlyMode: false,

  setActiveMember: (member) => set({ activeMember: member }),
  clearMember: () => set({ activeMember: null }),
  setMembersOnlyMode: (value) => set({ membersOnlyMode: !!value }),

  loadPromos: async (fetchFn) => {
    try {
      const promos = await fetchFn()
      set({ activePromos: promos })
    } catch (err) {
      console.error('Failed to load promotions:', err)
    }
  },

  addItem: (product, now = new Date()) => {
    const { orderItems, activeMember, activePromos, membersOnlyMode } = get()

    const standardPrice = product.standard_price
    // Member pricing applies when EITHER an individual member is active
    // OR the till is in event-wide members-only mode.
    const memberPrice = (activeMember || membersOnlyMode) ? product.member_price : null
    const promoPrice = getPromoPrice(product, activePromos, now)

    // Choose the lowest applicable price
    const candidates = [standardPrice]
    if (memberPrice != null) candidates.push(memberPrice)
    if (promoPrice != null) candidates.push(promoPrice)
    const price = Math.min(...candidates)

    const promo_price_applied = promoPrice != null && price === promoPrice
    const member_price_applied = memberPrice != null && price === memberPrice && !promo_price_applied

    const existing = orderItems.find(i => i.product_id === product.id)
    if (existing) {
      set({
        orderItems: orderItems.map(i =>
          i.product_id === product.id
            ? { ...i, quantity: i.quantity + 1, subtotal: (i.quantity + 1) * price }
            : i
        )
      })
    } else {
      set({
        orderItems: [...orderItems, {
          product_id: product.id,
          name: product.name,
          quantity: 1,
          unit_price: price,
          member_price_applied,
          promo_price_applied,
          subtotal: price,
        }]
      })
    }
  },

  /**
   * Add a fixed-price bundle to the order. Each product in the list gets a
   * line item priced at bundleTotal/N. Identical spirits in the same bundle
   * collapse into one line with quantity. Bundle items never merge with
   * existing standard-price items for the same product — the price differs,
   * so they stay as separate lines for receipt clarity.
   */
  addBundleItems: (productList, bundleTotal) => {
    if (!productList?.length) return
    const unitPrice = Number((bundleTotal / productList.length).toFixed(2))
    const groups = productList.reduce((acc, product) => {
      const existing = acc.find(g => g.product.id === product.id)
      if (existing) existing.qty++
      else acc.push({ product, qty: 1 })
      return acc
    }, [])
    const newItems = groups.map(({ product, qty }) => ({
      product_id: product.id,
      name: product.name,
      quantity: qty,
      unit_price: unitPrice,
      member_price_applied: false,
      promo_price_applied: false,
      bundle_price_applied: true,
      subtotal: Number((unitPrice * qty).toFixed(2)),
    }))
    set(state => ({ orderItems: [...state.orderItems, ...newItems] }))
  },

  removeItem: (product_id) =>
    set(state => ({ orderItems: state.orderItems.filter(i => i.product_id !== product_id) })),

  updateQuantity: (product_id, quantity) => {
    if (quantity <= 0) {
      set(state => ({ orderItems: state.orderItems.filter(i => i.product_id !== product_id) }))
    } else {
      set(state => ({
        orderItems: state.orderItems.map(i =>
          i.product_id === product_id
            ? { ...i, quantity, subtotal: quantity * i.unit_price }
            : i
        )
      }))
    }
  },

  clearOrder: () => set({ orderItems: [], activeMember: null }),

  getTotal: () => get().orderItems.reduce((sum, i) => sum + i.subtotal, 0),
}))
