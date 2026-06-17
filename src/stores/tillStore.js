// src/stores/tillStore.js
import { create } from 'zustand'
import { getPromoDiscount } from '../lib/promos'

/**
 * Pricing for the "N for the price of N-1" bottle deal: the single cheapest
 * unit is free, with the discount spread evenly across every unit so there is
 * no editable £0 freebie line. Pure and exported so the modal preview and the
 * order use ONE source of truth — the "Add to Order — £X" label can never
 * disagree with what the cart actually charges. `total` is unitPrice × count
 * (what the order sums to), which for equal-priced bottles is exactly the
 * price of N-1 (5 × £5.25 → £4.20/unit → £21.00).
 *
 * When `useMemberPrice` is true (a member is on the sale), the deal is worked
 * out from member prices so members get the deal off THEIR price, not standard.
 */
export function bottleBundlePricing(selected, useMemberPrice = false) {
  if (!selected?.length) return { unitPrice: 0, total: 0 }
  const priceOf = p => (useMemberPrice && p.member_price != null ? p.member_price : p.standard_price)
  const prices = selected.map(priceOf)
  const cheapest = Math.min(...prices)
  const bundleTotal = prices.reduce((sum, p) => sum + p, 0) - cheapest
  const unitPrice = Number((bundleTotal / selected.length).toFixed(2))
  const total = Number((unitPrice * selected.length).toFixed(2))
  return { unitPrice, total }
}

/**
 * Resolve the price a single product sells at, plus which discount won, given
 * the active member state and the winning promo discount. ONE source of truth
 * shared by addItem (what the cart charges) and ProductGrid (what the tile
 * shows + whether the PROMO tag appears), so the two can never drift apart.
 *
 * Stacking: when a member is on the sale AND a promo applies, the promo's
 * discount also comes off the member price — the same % for a percentage promo,
 * the same £ for a fixed-amount promo. The lowest resulting price wins.
 *
 * @param {object}      args.product   - needs standard_price
 * @param {number|null} args.memberPrice - member price if a member is on the sale, else null
 * @param {object|null} args.promo     - getPromoDiscount() result, or null
 * @returns {{ price: number, promo_price_applied: boolean, member_price_applied: boolean }}
 */
export function resolveSalePrice({ product, memberPrice, promo }) {
  const standardPrice = product.standard_price
  const promoPrice = promo?.price ?? null

  const candidates = [standardPrice]
  if (memberPrice != null) candidates.push(memberPrice)
  let memberPromoPrice = null
  if (promoPrice != null) {
    candidates.push(promoPrice)
    if (memberPrice != null) {
      const stacked = promo.discount_type === 'percentage'
        ? memberPrice * (1 - promo.discount_value / 100)
        : memberPrice - (standardPrice - promoPrice)
      memberPromoPrice = Math.max(0, Number(stacked.toFixed(2)))
      candidates.push(memberPromoPrice)
    }
  }
  const price = Math.min(...candidates)

  // A promo was applied if the winning price came from the promo — either the
  // plain promo price (non-member) or the member-stacked promo price.
  const promo_price_applied = promoPrice != null && (price === promoPrice || price === memberPromoPrice)
  const member_price_applied = !promo_price_applied && memberPrice != null && price === memberPrice
  return { price, promo_price_applied, member_price_applied }
}

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

    // Member pricing applies when EITHER an individual member is active OR the
    // till is in event-wide members-only mode. resolveSalePrice is shared with
    // ProductGrid so the cart charge always matches the tile.
    const memberPrice = (activeMember || membersOnlyMode) ? product.member_price : null
    const promo = getPromoDiscount(product, activePromos, now)
    const { price, promo_price_applied, member_price_applied } =
      resolveSalePrice({ product, memberPrice, promo })

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
   * Add a "5 for the price of 4" bottle deal to the order.
   *
   * "Price of 4" = the customer pays for everything except the single cheapest
   * bottle in the selection (with 5 equally-priced bottles that's exactly four
   * bottles' worth). The discount is spread evenly across the lines rather than
   * zeroing one line, so there is no editable £0 freebie a customer could nudge
   * up — every line shows the same blended unit price and the order total is
   * the price of 4.
   *
   * Identical bottles collapse into one line with quantity. Each call gets its
   * own unique line_id per line so running the deal twice (e.g. 10 bottles)
   * keeps the runs as separate, independently-editable lines instead of two
   * lines colliding on product_id in the order panel. Bundle lines never merge
   * with a plain grid tap for the same product (the price differs).
   *
   * Generic for any selection size: charges for all but the cheapest unit.
   */
  addBottleBundle: (selected) => {
    if (!selected?.length) return
    // A member on the sale (individually or via members-only mode) gets the
    // deal worked out from member prices.
    const { activeMember, membersOnlyMode } = get()
    const useMember = !!(activeMember || membersOnlyMode)
    const { unitPrice } = bottleBundlePricing(selected, useMember)

    const groups = selected.reduce((acc, product) => {
      const existing = acc.find(g => g.product.id === product.id)
      if (existing) existing.qty++
      else acc.push({ product, qty: 1 })
      return acc
    }, [])

    const newLineId = () =>
      (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.round(Math.random() * 1e9)}`)

    const newItems = groups.map(({ product, qty }) => ({
      line_id: `bundle:${newLineId()}`,
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
