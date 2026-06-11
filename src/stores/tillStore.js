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

    // Merge ONLY with a plain line for this product. Staff-credit lines
    // (line_id) and bundle lines (bundle_price_applied) share the same
    // product_id but are different sales — merging into them would bank
    // phantom staff credits / reprice bundle items.
    const isPlain = i => i.product_id === product.id && !i.line_id && !i.bundle_price_applied
    const existing = orderItems.find(isPlain)
    if (existing) {
      set({
        orderItems: orderItems.map(i =>
          isPlain(i)
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

  /**
   * Add a drink bought FOR a staff member ("one in for yourself" tip).
   * Always charged at standard price — member/promo discounts are for the
   * buyer's own drinks, not gifts — and never merged with the buyer's own
   * line for the same product, so the receipt and the order_items flag stay
   * unambiguous. The line carries staff_credit_for; the
   * create_order_with_items RPC banks one staff_drink_credits row per unit
   * and skips the sale stock movement (stock leaves when the drink is
   * poured at redemption, not when it's paid for).
   */
  addStaffCreditItem: (product, staffMember) => {
    const line_id = `credit:${staffMember.id}:${product.id}`
    const price = product.standard_price
    set(state => {
      const existing = state.orderItems.find(i => i.line_id === line_id)
      if (existing) {
        return {
          orderItems: state.orderItems.map(i =>
            i.line_id === line_id
              ? { ...i, quantity: i.quantity + 1, subtotal: (i.quantity + 1) * price }
              : i
          )
        }
      }
      return {
        orderItems: [...state.orderItems, {
          line_id,
          product_id: product.id,
          name: product.name,
          quantity: 1,
          unit_price: price,
          member_price_applied: false,
          promo_price_applied: false,
          staff_credit_for: staffMember.id,
          staff_credit_name: staffMember.name,
          subtotal: price,
        }]
      }
    })
  },

  // Lines are keyed by line_id when present (staff credit lines), falling
  // back to product_id for regular lines — a credit line and a normal line
  // for the same product must be removable independently.
  removeItem: (key) =>
    set(state => ({ orderItems: state.orderItems.filter(i => (i.line_id ?? i.product_id) !== key) })),

  updateQuantity: (key, quantity) => {
    if (quantity <= 0) {
      set(state => ({ orderItems: state.orderItems.filter(i => (i.line_id ?? i.product_id) !== key) }))
    } else {
      set(state => ({
        orderItems: state.orderItems.map(i =>
          (i.line_id ?? i.product_id) === key
            ? { ...i, quantity, subtotal: quantity * i.unit_price }
            : i
        )
      }))
    }
  },

  clearOrder: () => set({ orderItems: [], activeMember: null }),

  getTotal: () => get().orderItems.reduce((sum, i) => sum + i.subtotal, 0),
}))
