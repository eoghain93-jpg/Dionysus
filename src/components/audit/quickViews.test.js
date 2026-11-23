import { describe, it, expect } from 'vitest'
import {
  QUICK_VIEWS, DEFAULT_VIEW, buildFilters, defaultRange, findView, rangeToIso, recordFilters, recordFromParams,
} from './quickViews'

const KINDS = ['row', 'event', 'auth', 'guard', 'system']
const FILTER_KEYS = ['kinds', 'tables', 'action_prefix', 'min_severity', 'unchecked', 'q', 'actors', 'flag']
// Every list the audit log knows about (see the brief / migration).
const TABLES = [
  'products', 'orders', 'order_items', 'stock_movements', 'members', 'promotions', 'promotion_items',
  'promotion_categories', 'tab_adjustments', 'order_corrections', 'cashback_transactions', 'prize_wins',
  'guest_signins', 'z_reports', 'staff_drink_credits', 'product_price_changes', 'pin_attempts', 'till_devices',
  'z_report_recipients', 'monthly_report_recipients', 'suppliers', 'tab_payments',
]

describe('QUICK_VIEWS', () => {
  it('offers the views the owner asks for, alerts first', () => {
    expect(QUICK_VIEWS.map(v => v.label)).toEqual([
      'Needs a look', 'Everything', 'Prices and products', 'Sales and voids', 'Tabs and cash', 'Stock',
      'Members and staff', 'Sign-ins', 'Till actions', 'Outside the till',
    ])
    expect(DEFAULT_VIEW).toBe('attention')
    expect(findView(DEFAULT_VIEW).filters).toEqual([{ unchecked: true }])
    expect(findView('nonsense').id).toBe('attention')
  })

  it('uses only filters the database understands', () => {
    const ids = new Set()
    for (const view of QUICK_VIEWS) {
      expect(ids.has(view.id)).toBe(false)
      ids.add(view.id)
      expect(view.hint).toBeTruthy()
      expect(view.filters.length).toBeGreaterThan(0)
      for (const filter of view.filters) {
        for (const key of Object.keys(filter)) expect(FILTER_KEYS).toContain(key)
        for (const kind of filter.kinds ?? []) expect(KINDS).toContain(kind)
        for (const table of filter.tables ?? []) expect(TABLES).toContain(table)
      }
    }
  })

  it('shows every list somewhere other than "Everything"', () => {
    const covered = new Set(QUICK_VIEWS.flatMap(v => v.filters.flatMap(f => f.tables ?? [])))
    for (const table of TABLES) expect(covered.has(table), table).toBe(true)
  })

  it('puts things taken off an order before payment under "Sales and voids"', () => {
    expect(findView('sales').filters).toContainEqual({ kinds: ['event'], action_prefix: 'cart.' })
  })

  it('shows who was signed in alongside "Sign-ins" only', () => {
    expect(QUICK_VIEWS.filter(v => v.sessions).map(v => v.id)).toEqual(['signins'])
  })
})

describe('defaultRange and rangeToIso', () => {
  it('defaults to today and yesterday', () => {
    expect(defaultRange(new Date(2026, 10, 22, 9, 30))).toEqual({ from: '2026-11-21', to: '2026-11-22' })
    expect(defaultRange(new Date(2026, 0, 1, 0, 5))).toEqual({ from: '2025-12-31', to: '2026-01-01' })
  })

  it('covers from the start of the first day to the end of the last', () => {
    const iso = rangeToIso({ from: '2026-11-21', to: '2026-11-22' })
    expect(iso.from).toBe(new Date(2026, 10, 21).toISOString())
    expect(iso.to).toBe(new Date(2026, 10, 23).toISOString())
  })

  it('leaves out a date that is empty or not a date', () => {
    expect(rangeToIso({ from: '', to: 'tomorrow' })).toEqual({ from: null, to: null })
    expect(rangeToIso()).toEqual({ from: null, to: null })
  })
})

describe('recordFromParams and recordFilters', () => {
  it('reads table and pk from the address', () => {
    expect(recordFromParams(new URLSearchParams('table=products&pk=b0000000-0000-0000-0000-000000000001')))
      .toEqual({ table: 'products', pk: 'b0000000-0000-0000-0000-000000000001' })
  })

  it('ignores a half-given or odd-looking link', () => {
    expect(recordFromParams(new URLSearchParams('table=products'))).toBeNull()
    expect(recordFromParams(new URLSearchParams('pk=1'))).toBeNull()
    expect(recordFromParams(new URLSearchParams('table=Bad%20Name;drop&pk=1'))).toBeNull()
    expect(recordFromParams(new URLSearchParams(`table=products&pk=${'x'.repeat(101)}`))).toBeNull()
    expect(recordFromParams(null)).toBeNull()
  })

  it('asks for one record by table and pk; a sale brings its lines', () => {
    expect(recordFilters({ table: 'products', pk: 'p1' })).toEqual([{ table: 'products', pk: 'p1' }])
    expect(recordFilters({ table: 'orders', pk: 'o1' })).toEqual([{ table: 'orders', pk: 'o1' }, { table: 'order_items', pk: 'o1' }])
  })
})

describe('buildFilters', () => {
  const range = { from: '2026-11-21', to: '2026-11-22' }
  const dates = rangeToIso(range)

  it('shows unchecked alerts whatever their date', () => {
    expect(buildFilters({ view: findView('attention'), range })).toEqual([{ unchecked: true }])
  })

  it('adds the dates, staff member and till to every filter of a view', () => {
    const filters = buildFilters({ view: findView('prices'), range, staffId: 's1', tillId: 'till-2' })
    expect(filters).toHaveLength(findView('prices').filters.length)
    for (const filter of filters) {
      expect(filter).toMatchObject({ from: dates.from, to: dates.to, staff_id: 's1', till_id: 'till-2' })
    }
    expect(filters[1]).toMatchObject({ kinds: ['event'], action_prefix: 'pricing.' })
  })

  it('sends the search box to the database', () => {
    expect(buildFilters({ view: findView('everything'), range, search: '  guinness ' })).toEqual([{ from: dates.from, to: dates.to, q: 'guinness' }])
  })

  it('keeps a view’s own text and applies the search box on the till instead', () => {
    const filters = buildFilters({ view: findView('tabs'), range, search: 'mo member' })
    expect(filters[0]).toMatchObject({ tables: expect.arrayContaining(['tab_adjustments']), q: 'mo member' })
    expect(filters[0].local_q).toBeUndefined()
    expect(filters[1]).toMatchObject({ tables: ['members'], q: 'tab_balance', local_q: 'mo member' })
  })

  it('filters by flag and by who made the change in the database, so the search box still goes there', () => {
    const stock = buildFilters({ view: findView('stock'), range, search: 'guinness' })
    expect(stock[1]).toMatchObject({ tables: ['products'], flag: 'stock_typed_in', q: 'guinness' })
    expect(stock[1].local_q).toBeUndefined()

    const outside = buildFilters({ view: findView('outside'), range })
    expect(outside[0].actors).toEqual(['database', 'service', 'member', 'anon'])
    expect(outside.map(f => f.flag).filter(Boolean)).toEqual(['direct_edit_of_sale', 'direct_edit_of_protected_field'])
  })

  it('opens the whole history of one record, ignoring the view and the dates', () => {
    const filters = buildFilters({ view: findView('stock'), record: { table: 'products', pk: 'p1' }, range, staffId: 's1' })
    expect(filters).toEqual([{ table: 'products', pk: 'p1', staff_id: 's1' }])
  })

  it('does not change the view definitions it was given', () => {
    const before = JSON.stringify(QUICK_VIEWS)
    buildFilters({ view: findView('outside'), range, staffId: 's1', tillId: 't', search: 'x' })
    expect(JSON.stringify(QUICK_VIEWS)).toBe(before)
  })
})
