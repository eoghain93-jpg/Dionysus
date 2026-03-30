// src/lib/promos.js

/**
 * Parse a 'HH:MM' time string into total minutes since midnight.
 */
function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number)
  return h * 60 + m
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
function isPromoActive(promo, now) {
  if (!promo.active) return false

  const hasTimeWindow = promo.start_time != null && promo.end_time != null
  const hasDateRange = promo.start_date != null || promo.end_date != null

  if (!hasTimeWindow && !hasDateRange) return true

  if (hasTimeWindow) {
    const days = promo.days_of_week
    if (days != null && days.length > 0) {
      if (!days.includes(now.getDay())) return false
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
    const nowDateStr = toLocalDateStr(now)
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
export function getPromoPrice(product, promos, now = new Date()) {
  let lowestPrice = null

  for (const promo of promos) {
    if (!isPromoActive(promo, now)) continue

    const items = promo.promotion_items ?? []
    for (const item of items) {
      if (item.product_id !== product.id) continue

      const price = calcDiscountedPrice(product, item)

      // Promo must be strictly cheaper than standard price
      if (price >= product.standard_price) continue

      if (lowestPrice === null || price < lowestPrice) {
        lowestPrice = price
      }
    }
  }

  return lowestPrice
}
