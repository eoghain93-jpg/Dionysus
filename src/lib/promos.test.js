// src/lib/promos.test.js
import { describe, it, expect } from 'vitest'
import { getPromoPrice } from './promos'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProduct(id, standard_price = 5.00, member_price = 4.00) {
  return { id, name: 'Test Product', standard_price, member_price }
}

/**
 * Build a Date object for a specific day/time combination.
 * dayOfWeek: 0=Sun, 1=Mon ... 6=Sat
 * timeStr: 'HH:MM' in local time
 */
function makeDate(dayOfWeek, timeStr) {
  // Start from a known Sunday (2026-03-29 = Sunday)
  const base = new Date('2026-03-29T00:00:00')
  const daysToAdd = dayOfWeek
  const [hours, minutes] = timeStr.split(':').map(Number)
  const d = new Date(base)
  d.setDate(base.getDate() + daysToAdd)
  d.setHours(hours, minutes, 0, 0)
  return d
}

/**
 * Build a Date from a YYYY-MM-DD string at a given time.
 */
function makeDateOnDate(dateStr, timeStr = '12:00') {
  const [hours, minutes] = timeStr.split(':').map(Number)
  const d = new Date(dateStr + 'T00:00:00')
  d.setHours(hours, minutes, 0, 0)
  return d
}

// ---------------------------------------------------------------------------
// Base promo shape factories
// ---------------------------------------------------------------------------

function makeTimePromo({ id = 'promo-1', name = 'Happy Hour', active = true,
  start_time = '17:00', end_time = '19:00',
  days_of_week = null, items = [] } = {}) {
  return { id, name, active, start_time, end_time, days_of_week,
    start_date: null, end_date: null, promotion_items: items }
}

function makeDatePromo({ id = 'promo-2', name = 'Event Night', active = true,
  start_date = '2026-04-01', end_date = '2026-04-01', items = [] } = {}) {
  return { id, name, active, start_time: null, end_time: null,
    days_of_week: null, start_date, end_date, promotion_items: items }
}

function makeItem(product_id, discount_type = 'percentage', discount_value = 20) {
  return { id: 'item-1', promotion_id: 'promo-1', product_id, discount_type, discount_value }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const PROD = makeProduct('prod-1', 5.00, 4.00)

describe('getPromoPrice', () => {

  // -------------------------------------------------------------------------
  // No promos / inactive
  // -------------------------------------------------------------------------

  describe('no active promos', () => {
    it('returns null when promos array is empty', () => {
      const now = makeDate(1, '18:00') // Monday 18:00 — would be happy hour
      expect(getPromoPrice(PROD, [], now)).toBeNull()
    })

    it('returns null when promo is inactive', () => {
      const promo = makeTimePromo({
        active: false,
        items: [makeItem('prod-1', 'percentage', 20)],
      })
      const now = makeDate(1, '18:00')
      expect(getPromoPrice(PROD, [promo], now)).toBeNull()
    })

    it('returns null when product is not in any promo', () => {
      const promo = makeTimePromo({
        items: [makeItem('prod-OTHER', 'percentage', 20)],
      })
      const now = makeDate(1, '18:00')
      expect(getPromoPrice(PROD, [promo], now)).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // Time window promos
  // -------------------------------------------------------------------------

  describe('time window promos', () => {
    const promo = makeTimePromo({
      start_time: '17:00',
      end_time: '19:00',
      days_of_week: null, // every day
      items: [makeItem('prod-1', 'percentage', 20)],
    })

    it('applies when current time is within the window', () => {
      const now = makeDate(1, '18:00') // Monday 18:00
      expect(getPromoPrice(PROD, [promo], now)).toBe(4.00)
    })

    it('applies at the exact start boundary', () => {
      const now = makeDate(1, '17:00')
      expect(getPromoPrice(PROD, [promo], now)).toBe(4.00)
    })

    it('does not apply at the exact end boundary', () => {
      // end_time is exclusive
      const now = makeDate(1, '19:00')
      expect(getPromoPrice(PROD, [promo], now)).toBeNull()
    })

    it('does not apply before the window starts', () => {
      const now = makeDate(1, '16:59')
      expect(getPromoPrice(PROD, [promo], now)).toBeNull()
    })

    it('does not apply after the window ends', () => {
      const now = makeDate(1, '19:01')
      expect(getPromoPrice(PROD, [promo], now)).toBeNull()
    })

    it('applies midnight-spanning window: 22:00–02:00, before midnight', () => {
      const promo2 = makeTimePromo({
        start_time: '22:00',
        end_time: '02:00',
        days_of_week: null,
        items: [makeItem('prod-1', 'percentage', 10)],
      })
      const now = makeDate(5, '23:30') // Saturday 23:30
      expect(getPromoPrice(PROD, [promo2], now)).toBe(4.50)
    })

    it('applies midnight-spanning window: 22:00–02:00, after midnight', () => {
      const promo2 = makeTimePromo({
        start_time: '22:00',
        end_time: '02:00',
        days_of_week: null,
        items: [makeItem('prod-1', 'percentage', 10)],
      })
      const now = makeDate(6, '01:00') // Sunday 01:00
      expect(getPromoPrice(PROD, [promo2], now)).toBe(4.50)
    })

    it('does not apply outside a midnight-spanning window', () => {
      const promo2 = makeTimePromo({
        start_time: '22:00',
        end_time: '02:00',
        days_of_week: null,
        items: [makeItem('prod-1', 'percentage', 10)],
      })
      const now = makeDate(1, '12:00') // Monday midday
      expect(getPromoPrice(PROD, [promo2], now)).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // days_of_week filtering
  // -------------------------------------------------------------------------

  describe('days_of_week filtering', () => {
    const promo = makeTimePromo({
      start_time: '17:00',
      end_time: '19:00',
      days_of_week: [1, 2, 3], // Mon, Tue, Wed only
      items: [makeItem('prod-1', 'percentage', 20)],
    })

    it('applies on a matching day', () => {
      const now = makeDate(1, '18:00') // Monday
      expect(getPromoPrice(PROD, [promo], now)).toBe(4.00)
    })

    it('applies on another matching day in the list', () => {
      const now = makeDate(3, '18:00') // Wednesday
      expect(getPromoPrice(PROD, [promo], now)).toBe(4.00)
    })

    it('does not apply on a non-matching day', () => {
      const now = makeDate(5, '18:00') // Friday — not in [1,2,3]
      expect(getPromoPrice(PROD, [promo], now)).toBeNull()
    })

    it('does not apply on Sunday when days_of_week excludes it', () => {
      const now = makeDate(0, '18:00') // Sunday
      expect(getPromoPrice(PROD, [promo], now)).toBeNull()
    })

    it('applies on every day when days_of_week is null', () => {
      const promoEveryDay = makeTimePromo({
        start_time: '17:00',
        end_time: '19:00',
        days_of_week: null,
        items: [makeItem('prod-1', 'percentage', 20)],
      })
      expect(getPromoPrice(PROD, [promoEveryDay], makeDate(0, '18:00'))).toBe(4.00)
      expect(getPromoPrice(PROD, [promoEveryDay], makeDate(6, '18:00'))).toBe(4.00)
    })

    it('applies on every day when days_of_week is empty array', () => {
      const promoEveryDay = makeTimePromo({
        start_time: '17:00',
        end_time: '19:00',
        days_of_week: [],
        items: [makeItem('prod-1', 'percentage', 20)],
      })
      // Empty array is treated the same as null — every day
      expect(getPromoPrice(PROD, [promoEveryDay], makeDate(4, '18:00'))).toBe(4.00)
    })
  })

  // -------------------------------------------------------------------------
  // Date range promos
  // -------------------------------------------------------------------------

  describe('date range promos', () => {
    const promo = makeDatePromo({
      start_date: '2026-04-10',
      end_date: '2026-04-12',
      items: [makeItem('prod-1', 'percentage', 15)],
    })

    it('applies on the start date', () => {
      const now = makeDateOnDate('2026-04-10', '14:00')
      expect(getPromoPrice(PROD, [promo], now)).toBeCloseTo(4.25, 2)
    })

    it('applies on a date within the range', () => {
      const now = makeDateOnDate('2026-04-11', '20:00')
      expect(getPromoPrice(PROD, [promo], now)).toBeCloseTo(4.25, 2)
    })

    it('applies on the end date', () => {
      const now = makeDateOnDate('2026-04-12', '23:59')
      expect(getPromoPrice(PROD, [promo], now)).toBeCloseTo(4.25, 2)
    })

    it('does not apply before the start date', () => {
      const now = makeDateOnDate('2026-04-09', '23:59')
      expect(getPromoPrice(PROD, [promo], now)).toBeNull()
    })

    it('does not apply after the end date', () => {
      const now = makeDateOnDate('2026-04-13', '00:01')
      expect(getPromoPrice(PROD, [promo], now)).toBeNull()
    })

    it('applies on a single-day event (start_date === end_date)', () => {
      const singleDay = makeDatePromo({
        start_date: '2026-05-01',
        end_date: '2026-05-01',
        items: [makeItem('prod-1', 'fixed_price', 3.00)],
      })
      expect(getPromoPrice(PROD, [singleDay], makeDateOnDate('2026-05-01', '12:00'))).toBe(3.00)
      expect(getPromoPrice(PROD, [singleDay], makeDateOnDate('2026-04-30', '23:59'))).toBeNull()
      expect(getPromoPrice(PROD, [singleDay], makeDateOnDate('2026-05-02', '00:01'))).toBeNull()
    })

    it('date range with no end_date (open-ended) applies on any future date', () => {
      const openEnded = makeDatePromo({
        start_date: '2026-01-01',
        end_date: null,
        items: [makeItem('prod-1', 'percentage', 5)],
      })
      expect(getPromoPrice(PROD, [openEnded], makeDateOnDate('2030-12-31'))).toBeCloseTo(4.75, 2)
    })

    it('date range with no start_date applies up to end_date', () => {
      const noStart = makeDatePromo({
        start_date: null,
        end_date: '2026-12-31',
        items: [makeItem('prod-1', 'percentage', 5)],
      })
      expect(getPromoPrice(PROD, [noStart], makeDateOnDate('2026-06-01'))).toBeCloseTo(4.75, 2)
      expect(getPromoPrice(PROD, [noStart], makeDateOnDate('2027-01-01'))).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // Discount types
  // -------------------------------------------------------------------------

  describe('discount types', () => {
    it('fixed_price: returns discount_value directly as the price', () => {
      const promo = makeTimePromo({
        items: [makeItem('prod-1', 'fixed_price', 3.50)],
      })
      const now = makeDate(1, '18:00')
      expect(getPromoPrice(PROD, [promo], now)).toBe(3.50)
    })

    it('percentage: returns standard_price * (1 - discount_value/100)', () => {
      const promo = makeTimePromo({
        items: [makeItem('prod-1', 'percentage', 20)],
      })
      const now = makeDate(1, '18:00')
      // 5.00 * 0.80 = 4.00
      expect(getPromoPrice(PROD, [promo], now)).toBe(4.00)
    })

    it('percentage: 10% off £5.50 = £4.95', () => {
      const prod = makeProduct('prod-2', 5.50)
      const promo = makeTimePromo({
        items: [makeItem('prod-2', 'percentage', 10)],
      })
      expect(getPromoPrice(prod, [promo], makeDate(1, '18:00'))).toBeCloseTo(4.95, 2)
    })

    it('percentage: 100% off returns £0.00', () => {
      const promo = makeTimePromo({
        items: [makeItem('prod-1', 'percentage', 100)],
      })
      expect(getPromoPrice(PROD, [promo], makeDate(1, '18:00'))).toBe(0.00)
    })

    it('fixed_price: returns £0.00 if discount_value is 0', () => {
      const promo = makeTimePromo({
        items: [makeItem('prod-1', 'fixed_price', 0)],
      })
      expect(getPromoPrice(PROD, [promo], makeDate(1, '18:00'))).toBe(0.00)
    })
  })

  // -------------------------------------------------------------------------
  // Multiple overlapping promos — lowest price wins
  // -------------------------------------------------------------------------

  describe('multiple overlapping promos', () => {
    it('returns the lower of two overlapping fixed-price promos', () => {
      const promo1 = makeTimePromo({ id: 'p1', items: [makeItem('prod-1', 'fixed_price', 4.00)] })
      const promo2 = makeTimePromo({ id: 'p2', items: [makeItem('prod-1', 'fixed_price', 3.50)] })
      expect(getPromoPrice(PROD, [promo1, promo2], makeDate(1, '18:00'))).toBe(3.50)
    })

    it('returns the lower of a fixed-price and percentage promo', () => {
      // 20% off £5 = £4.00, fixed £3.50 — fixed wins
      const promo1 = makeTimePromo({ id: 'p1', items: [makeItem('prod-1', 'percentage', 20)] })
      const promo2 = makeTimePromo({ id: 'p2', items: [makeItem('prod-1', 'fixed_price', 3.50)] })
      expect(getPromoPrice(PROD, [promo1, promo2], makeDate(1, '18:00'))).toBe(3.50)
    })

    it('returns the lower of two percentage promos', () => {
      // 10% off £5 = £4.50, 30% off £5 = £3.50
      const promo1 = makeTimePromo({ id: 'p1', items: [makeItem('prod-1', 'percentage', 10)] })
      const promo2 = makeTimePromo({ id: 'p2', items: [makeItem('prod-1', 'percentage', 30)] })
      expect(getPromoPrice(PROD, [promo1, promo2], makeDate(1, '18:00'))).toBeCloseTo(3.50, 2)
    })

    it('promo never increases the price — does not return a higher fixed_price', () => {
      // fixed_price higher than standard_price — should be ignored
      const promo = makeTimePromo({
        items: [makeItem('prod-1', 'fixed_price', 9.99)],
      })
      // 9.99 > 5.00 (standard_price) so promo price should not be applied
      expect(getPromoPrice(PROD, [promo], makeDate(1, '18:00'))).toBeNull()
    })

    it('promo never increases the price — percentage discount of 0% is ignored', () => {
      const promo = makeTimePromo({
        items: [makeItem('prod-1', 'percentage', 0)],
      })
      // 0% off = same price, not cheaper, so treated as no discount
      expect(getPromoPrice(PROD, [promo], makeDate(1, '18:00'))).toBeNull()
    })

    it('only the active promo with a matching product applies out of a mixed list', () => {
      const matching = makeTimePromo({
        id: 'p-match',
        items: [makeItem('prod-1', 'percentage', 25)],
      })
      const wrongProduct = makeTimePromo({
        id: 'p-wrong',
        items: [makeItem('prod-OTHER', 'fixed_price', 1.00)],
      })
      const inactive = makeTimePromo({
        id: 'p-inactive',
        active: false,
        items: [makeItem('prod-1', 'fixed_price', 1.00)],
      })
      expect(getPromoPrice(PROD, [matching, wrongProduct, inactive], makeDate(1, '18:00')))
        .toBeCloseTo(3.75, 2)
    })

    it('returns null when all matching promos are outside their time window', () => {
      const promo1 = makeTimePromo({
        id: 'p1', start_time: '17:00', end_time: '19:00',
        items: [makeItem('prod-1', 'percentage', 20)],
      })
      const promo2 = makeTimePromo({
        id: 'p2', start_time: '20:00', end_time: '22:00',
        items: [makeItem('prod-1', 'percentage', 30)],
      })
      // 14:00 — neither window is active
      expect(getPromoPrice(PROD, [promo1, promo2], makeDate(1, '14:00'))).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles promos with no promotion_items', () => {
      const promo = makeTimePromo({ items: [] })
      expect(getPromoPrice(PROD, [promo], makeDate(1, '18:00'))).toBeNull()
    })

    it('handles a promo with both time window AND date range — both must match', () => {
      // This promo has start_time/end_time AND a start_date/end_date
      const combo = {
        id: 'combo-1',
        name: 'Combo Promo',
        active: true,
        start_time: '17:00',
        end_time: '19:00',
        days_of_week: null,
        start_date: '2026-04-10',
        end_date: '2026-04-10',
        promotion_items: [makeItem('prod-1', 'percentage', 20)],
      }
      // Correct date, correct time — should apply
      expect(getPromoPrice(PROD, [combo], makeDateOnDate('2026-04-10', '18:00'))).toBe(4.00)
      // Correct date, wrong time — should NOT apply
      expect(getPromoPrice(PROD, [combo], makeDateOnDate('2026-04-10', '14:00'))).toBeNull()
      // Wrong date, correct time — should NOT apply
      expect(getPromoPrice(PROD, [combo], makeDateOnDate('2026-04-11', '18:00'))).toBeNull()
    })

    it('uses the provided `now` argument rather than the real clock', () => {
      const promo = makeTimePromo({
        start_time: '09:00',
        end_time: '10:00',
        items: [makeItem('prod-1', 'fixed_price', 2.00)],
      })
      const duringWindow = makeDate(1, '09:30')
      const outsideWindow = makeDate(1, '10:30')
      expect(getPromoPrice(PROD, [promo], duringWindow)).toBe(2.00)
      expect(getPromoPrice(PROD, [promo], outsideWindow)).toBeNull()
    })

    it('handles promotion_items on a promo that covers multiple products', () => {
      const prod2 = makeProduct('prod-2', 6.00)
      const promo = makeTimePromo({
        items: [
          makeItem('prod-1', 'percentage', 20),
          { id: 'item-2', promotion_id: 'promo-1', product_id: 'prod-2', discount_type: 'fixed_price', discount_value: 4.00 },
        ],
      })
      const now = makeDate(1, '18:00')
      expect(getPromoPrice(PROD, [promo], now)).toBe(4.00)   // 20% off 5.00
      expect(getPromoPrice(prod2, [promo], now)).toBe(4.00)  // fixed £4.00
    })

    it('rounds percentage discount result to 2 decimal places', () => {
      const prod = makeProduct('prod-3', 3.33)
      const promo = makeTimePromo({
        items: [makeItem('prod-3', 'percentage', 10)],
      })
      // 3.33 * 0.90 = 2.997 → rounds to 3.00
      const result = getPromoPrice(prod, [promo], makeDate(1, '18:00'))
      expect(result).toBe(3.00)
    })

    it('handles undefined days_of_week (same as null — every day)', () => {
      const promo = {
        ...makeTimePromo({ items: [makeItem('prod-1', 'percentage', 20)] }),
        days_of_week: undefined,
      }
      expect(getPromoPrice(PROD, [promo], makeDate(6, '18:00'))).toBe(4.00) // Saturday
    })
  })
})
