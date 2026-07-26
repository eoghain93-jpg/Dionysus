// src/lib/promos.js

import { TRADING_DAY_CUTOFF_HOURS } from './tradingDay'

/**
 * Parse a 'HH:MM' time string into total minutes since midnight.
 */
function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number)
  return h * 60 + m
}

/**
 * Reference moment for CALENDAR checks (date range, day of week): before
 * 6am the trading day is still yesterday, so a match-night promo dated
 * for the match survives extra time past midnight. Time-of-day windows
 * keep the real clock — they already span midnight explicitly.
 */
function tradingRef(now) {
  return new Date(now.getTime() - TRADING_DAY_CUTOFF_HOURS * 60 * 60 * 1000)
}

/**
 * Get YYYY-MM-DD string from a Date in local time.
 */
function toLocalDateStr(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Determine whether a promotion is currently active given `now`.
 *
 * Rules:
 * - promo.active must be true
 * - If the promo has a time window (start_time + end_time):
 *     - days_of_week (if non-empty) must include the current day
 *     - current time must be within [start_time, end_time)
 *     - Supports midnight-spanning windows (start_time > end_time)
 * - If the promo has a date range (start_date and/or end_date):
 *     - current date must fall within [start_date, end_date] (inclusive, string compare)
 * - If a promo has BOTH a time window and a date range, both conditions must hold.
 */
export function isPromoActive(promo, now) {
  if (!promo.active) return false

  const hasTimeWindow = promo.start_time != null && promo.end_time != null
  const hasDateRange = promo.start_date != null || promo.end_date != null

  if (!hasTimeWindow && !hasDateRange) return true

  if (hasTimeWindow) {
    const days = promo.days_of_week
    if (days != null && days.length > 0) {
      if (!days.includes(tradingRef(now).getDay())) return false
    }

    const currentMinutes = now.getHours() * 60 + now.getMinutes()
    const startMinutes = timeToMinutes(promo.start_time)
    const endMinutes = timeToMinutes(promo.end_time)

    let inWindow
    if (startMinutes < endMinutes) {
      // Normal window e.g. 17:00–19:00
      inWindow = currentMinutes >= startMinutes && currentMinutes < endMinutes
    } else {
      // Midnight-spanning window e.g. 22:00–02:00
      inWindow = currentMinutes >= startMinutes || currentMinutes < endMinutes
    }

    if (!inWindow) return false
  }

  if (hasDateRange) {
    const nowDateStr = toLocalDateStr(tradingRef(now))
    if (promo.start_date != null && nowDateStr < promo.start_date) return false
    if (promo.end_date != null && nowDateStr > promo.end_date) return false
  }

  return true
}

/**
 * Calculate the promo price for a single item from a single promotion_item entry.
 * Returns the computed price as a number.
 */
function calcDiscountedPrice(product, item) {
  if (item.discount_type === 'fixed_price') {
    return item.discount_value
  }
  // percentage
  const discounted = product.standard_price * (1 - item.discount_value / 100)
  return Math.round(discounted * 100) / 100
}

/**
 * Returns the lowest applicable promo price for `product` given the list of
 * promotions and the current time. Returns null if no active promo applies.
 *
 * A promo never increases the price — if the computed promo price is >= the
 * standard_price it is ignored.
 *
 * @param {object} product  - Product object with id, standard_price
 * @param {Array}  promos   - Array of promotion objects each with promotion_items[]
 * @param {Date}   [now]    - Defaults to new Date()
 * @returns {number|null}
 */
/**
 * Returns the winning (lowest) promo discount for `product` as
 * { price, discount_type, discount_value }, or null if none applies. Same
 * selection rules as getPromoPrice — this just also reports WHICH discount won,
 * so callers can stack the same kind of discount onto a different base (e.g.
 * the member price). Item discounts and category discounts are both considered;
 * the lowest price wins, ties favouring the product-level item.
 */
export function getPromoDiscount(product, promos, now = new Date()) {
  let best = null

  for (const promo of promos) {
    if (!isPromoActive(promo, now)) continue

    const consider = (entry) => {
      const price = calcDiscountedPrice(product, entry)
      if (price >= product.standard_price) return
      if (best === null || price < best.price) {
        best = { price, discount_type: entry.discount_type, discount_value: entry.discount_value }
      }
    }

    // Product-level discounts first (so they win ties over category discounts).
    for (const item of promo.promotion_items ?? []) {
      if (item.product_id === product.id) consider(item)
    }
    for (const catItem of promo.promotion_categories ?? []) {
      if (catItem.category === product.category) consider(catItem)
    }
  }

  return best
}

/**
 * Lowest applicable promo price for `product`, or null. Thin wrapper over
 * getPromoDiscount for callers that only need the price (e.g. the product grid).
 */
export function getPromoPrice(product, promos, now = new Date()) {
  return getPromoDiscount(product, promos, now)?.price ?? null
}

/**
 * Is a code-based bundle (e.g. the bottle 5-for-4 button) currently enabled?
 *
 * The bundle is gated by a "marker" promotion — a normal promotions row with
 * NO discount items, used purely as an on/off switch staff can toggle from the
 * Promos page. The bundle button shows only while a promo named `markerName`
 * is active for `now`. This reuses the existing promo scheduling/toggle UX and
 * the date backstop (a single-day marker auto-hides the button when the
 * trading day ends at 6am — surviving extra time past midnight).
 *
 * @param {Array}  promos      - active promotions (as loaded into the till)
 * @param {string} markerName  - exact name of the marker promotion
 * @param {Date}   [now]
 * @returns {boolean}
 */
export function isBundleEnabled(promos, markerName, now = new Date()) {
  return (promos ?? []).some(p => p.name === markerName && isPromoActive(p, now))
}
