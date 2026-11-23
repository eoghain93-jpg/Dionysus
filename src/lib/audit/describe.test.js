import { describe, it, expect } from 'vitest'
import {
  combineSaleEntries, coverageLabel, coverageLines, describeCheck, describeEntry, describeProblem, describeVia,
  describeWho, duration, entryFlags, entrySeverity, fieldLabel, flagLabel, formatBytes, formatValue, happenedAt,
  money, salesIndex, tableNoun, tillLabel, uncheckedSeqs, viaGraphql,
} from './describe'

// Entries below are modelled on what supabase/tests/audit.test.sql produces
// (same people, products and ids), in the shape audit_view() returns them.
const SAM = '5a000000-0000-0000-0000-000000000001'
const KIM = '5a000000-0000-0000-0000-000000000002'
const MO = 'a0000000-0000-0000-0000-000000000003'
const GUINNESS = 'b0000000-0000-0000-0000-000000000001'
const CRISPS = 'b0000000-0000-0000-0000-000000000002'
const PROMO = 'd0000000-0000-0000-0000-000000000001'
const ORDER1 = 'c0000000-0000-0000-0000-000000000001'
const ORDER2 = 'c0000000-0000-0000-0000-000000000002'
const ORDER3 = 'c0000000-0000-0000-0000-000000000003'
const LINE1 = 'e1000000-0000-0000-0000-000000000001'
const LINE2 = 'e1000000-0000-0000-0000-000000000002'

const names = {
  [SAM]: 'Sam Staff',
  [KIM]: 'Kim Newstarter',
  [MO]: 'Mo Member',
  [GUINNESS]: 'Guinness',
  [CRISPS]: 'Crisps',
  [PROMO]: 'Happy hour',
}

let nextSeq = 1000
const base = () => ({
  seq: nextSeq++,
  at: '2026-11-21T14:02:00.000Z',
  severity: 0,
  table: null,
  pk: null,
  subject: null,
  old: null,
  new: null,
  changed: null,
  detail: null,
  actor: 'till',
  till_id: 'till-1',
  staff_id: SAM,
  staff_name: 'Sam Staff',
  staff_trust: 'pin',
  via: 'PATCH /products',
  ip: '203.0.113.10',
  app_build: 'test123',
  client_at: null,
  sealed: true,
  checked: false,
})
const row = (table, action, extra = {}) => ({ ...base(), kind: 'row', table, action, ...extra })
const auth = (action, pk, subject, detail, extra = {}) => ({
  ...base(), kind: 'auth', action, table: 'members', pk, subject, detail, via: 'POST /rpc/staff_sign_in', ...extra,
})
const guard = (action, table, extra = {}) => ({
  ...base(), kind: 'guard', action, table, severity: 3, detail: { rule: 'immutable', flags: ['history_rewrite_attempt'] }, ...extra,
})
const system = (action, detail = null, extra = {}) => ({ ...base(), kind: 'system', action, detail, ...extra })
const event = (action, detail = {}, extra = {}) => ({
  ...base(), kind: 'event', action, via: 'POST /rpc/audit_log_events', client_at: '2026-11-21T14:02:00.000Z',
  detail: { ...detail, till: 'till-1', page: '/' }, ...extra,
})
const nobody = { staff_id: null, staff_name: null, staff_trust: 'none' }
const fromDatabase = { ...nobody, actor: 'database', till_id: null, via: 'sql:postgres/psql', ip: null, app_build: null }

// Words the owner should never have to read.
const JARGON = /\b(rows?|rpc|triggers?|hash(es)?|uuid|null|undefined|NaN)\b/i
const UUID_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
function expectPlain(description) {
  for (const text of [description.title, ...description.lines, ...description.tags]) {
    expect(text).not.toMatch(JARGON)
    expect(text).not.toMatch(UUID_TEXT)
  }
}

const title = (entry, ctx = { names }) => describeEntry(entry, ctx).title
const lines = (entry, ctx = { names }) => describeEntry(entry, ctx).lines
const tags = (entry, ctx = { names }) => describeEntry(entry, ctx).tags

const saleEntry = () => row('orders', 'insert', {
  pk: ORDER1,
  via: 'POST /rpc/create_order_with_items',
  new: {
    id: ORDER1, member_id: MO, staff_id: SAM, payment_method: 'tab', total_amount: 13.8, status: 'paid',
    till_id: 'till-1', created_at: '2026-11-21T14:02:00.000Z', is_tab_settlement: false, prev_last_settled_at: null,
  },
  detail: { rung_by_trust: 'pin' },
})
const saleLinesEntry = () => row('order_items', 'insert', {
  pk: ORDER1,
  via: 'POST /rpc/create_order_with_items',
  new: [
    { id: LINE1, product_id: GUINNESS, quantity: 2, unit_price: 6.4, member_price_applied: true, staff_credit_for: null },
    { id: LINE2, product_id: CRISPS, quantity: 1, unit_price: 0.5, member_price_applied: false, staff_credit_for: null },
  ],
  detail: {
    lines: {
      [LINE1]: { product: 'Guinness', list_standard: 7.4, list_member: 6.4 },
      [LINE2]: { product: 'Crisps', list_standard: 1, list_member: 1, below_list_price: true },
    },
    rows: 2,
    flags: ['below_list_price'],
  },
})

describe('money and other formatting', () => {
  it('formats money as £0.00 with the sign in front', () => {
    expect(money(7.4)).toBe('£7.40')
    expect(money('13.80')).toBe('£13.80')
    expect(money(0)).toBe('£0.00')
    expect(money(-1.5)).toBe('-£1.50')
    expect(money(-0.001)).toBe('£0.00')
    expect(money(null)).toBe('£?')
    expect(money('abc')).toBe('£?')
  })

  it('words durations, sizes and tills', () => {
    expect(duration(45)).toBe('45 seconds')
    expect(duration(60 * 14)).toBe('14 minutes')
    expect(duration(3 * 3600)).toBe('3 hours')
    expect(duration(3600)).toBe('60 minutes')
    expect(duration(4 * 86400)).toBe('4 days')
    expect(formatBytes(900)).toBe('900 bytes')
    expect(formatBytes(4.2 * 1024 * 1024)).toBe('4.2 MB')
    expect(tillLabel('till-2')).toBe('Till 2')
    expect(tillLabel(null)).toBeNull()
  })

  it('names lists and columns in plain words, whatever they are called', () => {
    expect(tableNoun('order_items')).toBe('sale line')
    expect(tableNoun('orders', true)).toBe('sales')
    expect(tableNoun('purchase_orders')).toBe('purchase order')
    expect(fieldLabel('standard_price')).toBe('standard price')
    expect(fieldLabel('pin_hash')).toBe('PIN')
    expect(fieldLabel('row_hash')).toBe('entry code')
    expect(flagLabel('member_discount_removed')).toBe('Member discount removed')
    expect(flagLabel('some_new_flag')).toBe('Some new flag')
  })

  it('formats stored values, turning ids into names and never showing a PIN value', () => {
    expect(formatValue('standard_price', 7.4)).toBe('£7.40')
    expect(formatValue('active', false)).toBe('no')
    expect(formatValue('member_id', MO, { names })).toBe('Mo Member')
    expect(formatValue('member_id', MO, {})).toBe(MO)
    expect(formatValue('pin_hash', '[redacted]')).toBe('PIN set (hidden)')
    expect(formatValue('pin_hash', null)).toBe('no PIN')
    expect(formatValue('notes', null)).toBe('—')
    expect(formatValue('till_id', 'till-1')).toBe('Till 1')
    expect(formatValue('payment_method', 'tab')).toBe('tab')
    expect(formatValue('rung_by_trust', 'session_record')).toBe('matched a sign-in')
    expect(formatValue('late_by_seconds', 10800)).toBe('3 hours')
    expect(formatValue('flags', ['voided', 'price_changed'])).toBe('Voided, Price changed')
    expect(formatValue('tills', { 'till-1': { variance: 1.2 } })).toContain('£1.20')
    expect(formatValue('reason', 'idle_lock')).toBe('idle lock')
    expect(formatValue('email', 'sam_staff@example.test')).toBe('sam_staff@example.test')
    expect(formatValue('problems', [{ seal: 3, problem: 'rows_do_not_match_seal' }])).toBe('The entries in sealed batch 3 no longer match their seal.')
  })
})

describe('formatValue — the newer details', () => {
  it('words rules, check scopes, coverage lists and who sent a sale', () => {
    expect(formatValue('rule', 'protected_fields')).toBe('only the app’s own PIN-checked steps may change these')
    expect(formatValue('rule', 'no_delete')).toBe('may never be deleted from a till')
    expect(formatValue('scope', 'recent')).toBe('every seal, and the entries of recent weeks')
    expect(formatValue('scope', 'everything')).toBe('the whole log')
    expect(formatValue('repointed', ['products:truncate', 'orders:guard'])).toBe('products being wiped all at once, the guard on sales')
    expect(formatValue('missing', [])).toBe('nothing')
    expect(formatValue('sent_by', SAM, { names })).toBe('Sam Staff')
    expect(formatValue('sent_by_trust', 'pin')).toBe('PIN checked')
    expect(fieldLabel('sent_by')).toBe('signed in when it was sent')
    expect(fieldLabel('seals_rehashed')).not.toMatch(/hash/i)
  })
})

describe('describeEntry — changes to the books (kind: row)', () => {
  describe('products', () => {
    it('describes the incident: a standard price changed', () => {
      const entry = row('products', 'update', {
        pk: GUINNESS, subject: 'Guinness', severity: 2,
        changed: ['standard_price'], old: { standard_price: 7.4 }, new: { standard_price: 6.4 },
        detail: { flags: ['price_changed', 'member_discount_removed'] },
      })
      const d = describeEntry(entry, { names })
      expect(d.title).toBe('Changed Guinness standard price from £7.40 to £6.40')
      expect(d.tags).toEqual(['Price changed', 'Member discount removed'])
      expect(d.category).toBe('prices')
    })

    it('describes both prices changing', () => {
      const entry = row('products', 'update', {
        pk: GUINNESS, subject: 'Guinness', changed: ['member_price', 'standard_price'],
        old: { standard_price: 7.4, member_price: 6.4 }, new: { standard_price: 7.6, member_price: 6.6 },
      })
      expect(title(entry)).toBe('Changed Guinness: members’ price from £6.40 to £6.60; standard price from £7.40 to £7.60')
    })

    it('describes a product taken off sale and put back', () => {
      const off = row('products', 'update', { pk: GUINNESS, subject: 'Guinness', changed: ['active'], old: { active: true }, new: { active: false } })
      const on = row('products', 'update', { pk: GUINNESS, subject: 'Guinness', changed: ['active'], old: { active: false }, new: { active: true } })
      expect(title(off)).toBe('Took Guinness off sale')
      expect(title(on)).toBe('Put Guinness back on sale')
    })

    it('describes a stock figure typed into the product form', () => {
      const entry = row('products', 'update', {
        pk: GUINNESS, subject: 'Guinness', changed: ['stock_quantity'], old: { stock_quantity: 98 }, new: { stock_quantity: 500 },
        detail: { flags: ['stock_typed_in'] },
      })
      const d = describeEntry(entry, { names })
      expect(d.title).toBe('Set Guinness stock count from 98 to 500 by typing it in')
      expect(d.tags).toEqual(['Stock figure typed in'])
      expect(d.category).toBe('stock')
    })

    it('leads with the price when several things change at once', () => {
      const entry = row('products', 'update', {
        pk: GUINNESS, subject: 'Guinness', changed: ['category', 'name', 'par_level', 'standard_price'],
        old: { category: 'draught', name: 'Guinness', par_level: 0, standard_price: 7.4 },
        new: { category: 'bottle', name: 'Guinness 0.0', par_level: 5, standard_price: 5 },
      })
      const d = describeEntry(entry, { names })
      expect(d.title).toBe('Changed Guinness: standard price from £7.40 to £5.00 (and category, name, par level)')
      expect(d.lines).toEqual(['Category from draught to bottle', 'Renamed from “Guinness” to “Guinness 0.0”', 'Par level from 0 to 5'])
    })

    it('describes a rename, a new product and a deleted one', () => {
      const renamed = row('products', 'update', { pk: GUINNESS, subject: 'Stout', changed: ['name'], old: { name: 'Guinness' }, new: { name: 'Stout' } })
      const added = row('products', 'insert', {
        pk: GUINNESS, subject: 'Guinness',
        new: { id: GUINNESS, name: 'Guinness', category: 'draught', standard_price: 7.4, member_price: 6.4, stock_quantity: 100, active: true },
      })
      const deleted = row('products', 'delete', { pk: CRISPS, subject: null, old: { id: CRISPS, name: 'Crisps', standard_price: 1 }, severity: 2 })
      expect(title(renamed)).toBe('Renamed product “Guinness” to “Stout”')
      expect(title(added)).toBe('Added product Guinness (standard £7.40, members £6.40)')
      expect(title(deleted)).toBe('Deleted product Crisps')
    })

    it('describes the price change record written alongside', () => {
      const changed = row('product_price_changes', 'insert', {
        new: { id: 'x', product_id: GUINNESS, old_standard_price: 7.4, new_standard_price: 6.4, old_member_price: 6.4, new_member_price: 6.4 },
      })
      const opening = row('product_price_changes', 'insert', {
        new: { id: 'y', product_id: CRISPS, old_standard_price: null, new_standard_price: 1, old_member_price: null, new_member_price: 1 },
      })
      expect(title(changed)).toBe('Price change noted for Guinness: standard price from £7.40 to £6.40')
      expect(title(opening)).toBe('Opening prices noted for Crisps: standard £1.00, members £1.00')
    })
  })

  describe('sales', () => {
    it('describes a sale on its own, and with its lines folded in', () => {
      expect(title(saleEntry())).toBe('Sale of £13.80 on tab')
      const [combined] = combineSaleEntries([saleLinesEntry(), saleEntry()])
      const d = describeEntry(combined, { names })
      expect(d.title).toBe('Sale of £13.80 on tab: 2 × Guinness, 1 × Crisps')
      expect(d.lines).toEqual(['Crisps sold at £0.50 each — list price £1.00', 'Put on Mo Member’s tab'])
      expect(d.tags).toEqual(['Sold below list price'])
      expect(d.category).toBe('sales')
    })

    it('describes the lines of a sale when they are all there is', () => {
      const d = describeEntry(saleLinesEntry(), { names })
      expect(d.title).toBe('Sale lines: 2 × Guinness, 1 × Crisps (£13.30)')
      expect(d.lines).toEqual(['Crisps sold at £0.50 each — list price £1.00'])
      expect(d.tags).toEqual(['Sold below list price'])
    })

    it('says so when a line was bought as a drink for staff', () => {
      const entry = saleLinesEntry()
      entry.new[0].staff_credit_for = KIM
      expect(lines(entry)).toContain('2 × Guinness bought as a drink for Kim Newstarter')
    })

    // A sale is filed under WHO RANG IT (as the sale itself claims); who was
    // signed in when it reached the server travels alongside as sent_by.
    it('describes an offline sale that arrived late under someone else’s sign-in', () => {
      const entry = row('orders', 'insert', {
        pk: ORDER2, via: 'POST /rpc/create_order_with_items', severity: 1,
        staff_id: KIM, staff_name: 'Kim Newstarter', staff_trust: 'claimed',
        new: { id: ORDER2, staff_id: KIM, payment_method: 'cash', total_amount: 7.4, till_id: 'till-2', created_at: '2026-11-21T11:02:00.000Z' },
        detail: {
          late_by_seconds: 10800, rung_by_trust: 'claimed', sent_by: SAM, sent_by_trust: 'pin',
          flags: ['arrived_late', 'till_claim_mismatch', 'staff_unverified'],
        },
      })
      const d = describeEntry(entry, { names })
      expect(d.title).toBe('Sale of £7.40 by cash')
      expect(d.lines).toEqual([
        'Sent to the server under Sam Staff’s sign-in (PIN checked) — the sale itself names Kim Newstarter as who rang it',
        'Reached the server 3 hours after it was rung — usually a sale taken while the till was offline',
        'The sale says Till 2 but it was sent by Till 1',
      ])
      expect(d.tags).toEqual(['Arrived 3 hours late', 'Till name does not match the till that sent it', 'Staff member not confirmed'])
      expect(describeWho(entry, { names })).toEqual({ name: 'Kim Newstarter', tag: 'said to be', trust: 'claimed' })
      expectPlain(d)
      // ...and with no names to hand it still never shows an id
      expectPlain(describeEntry(entry, {}))
      expect(lines(entry, {})[0]).toBe('Sent to the server under someone else’s sign-in (PIN checked) — the sale itself names Kim Newstarter as who rang it')
    })

    it('says when a replayed sale was matched to a sign-in', () => {
      const entry = row('orders', 'insert', {
        pk: 'c0000000-0000-0000-0000-000000000004', staff_id: SAM, staff_name: 'Sam Staff', staff_trust: 'session_record',
        new: { staff_id: SAM, payment_method: 'cash', total_amount: 7.4, till_id: 'till-1', created_at: '2026-11-21T11:01:30.000Z' },
        detail: { late_by_seconds: 10830, rung_by_trust: 'session_record', sent_by: KIM, sent_by_trust: 'pin', flags: ['arrived_late'] },
      })
      expect(describeWho(entry, { names })).toEqual({ name: 'Sam Staff', tag: 'matched a sign-in', trust: 'session_record' })
      expect(lines(entry)[0]).toBe('Sent to the server under Kim Newstarter’s sign-in (PIN checked) — the sale itself names Sam Staff as who rang it')
    })

    it('says nothing extra about an ordinary live sale: who rang it is who was signed in', () => {
      const entry = saleEntry()
      expect(describeWho(entry, { names })).toEqual({ name: 'Sam Staff', tag: 'PIN checked', trust: 'pin' })
      expect(lines(entry)).toEqual(['Put on Mo Member’s tab'])
    })

    it('flags a live sale that names someone other than the person signed in', () => {
      const entry = row('orders', 'insert', {
        pk: ORDER2, via: 'POST /rpc/create_order_with_items', severity: 2,
        staff_id: KIM, staff_name: 'Kim Newstarter', staff_trust: 'claimed',
        new: { id: ORDER2, staff_id: KIM, payment_method: 'cash', total_amount: 7.4, till_id: 'till-1', created_at: '2026-11-21T14:02:00.000Z' },
        detail: { rung_by_trust: 'claimed', sent_by: SAM, sent_by_trust: 'pin', flags: ['staff_mismatch'] },
      })
      const d = describeEntry(entry, { names })
      expect(d.lines).toEqual(['Sam Staff was the person signed in (PIN checked), but the till put Kim Newstarter on the sale as who rang it'])
      expect(d.tags).toEqual(['Sale names someone other than the person signed in'])
      expect(describeWho(entry, { names }).tag).toBe('said to be')
    })

    it('does not credit a sale that names nobody to whoever happened to send it', () => {
      // live: the signed-in person stays the headline, and the line says why
      const live = row('orders', 'insert', {
        pk: ORDER3, new: { id: ORDER3, payment_method: 'card', total_amount: 1 },
        detail: { sent_by: SAM, sent_by_trust: 'pin', flags: ['no_staff_on_sale'] },
      })
      expect(describeWho(live, { names })).toEqual({ name: 'Sam Staff', tag: 'PIN checked', trust: 'pin' })
      expect(lines(live)).toEqual(['The sale itself does not say who rang it. Sam Staff was signed in when it was sent (PIN checked)'])

      // sent in later: nobody is headlined
      const late = row('orders', 'insert', {
        ...nobody, pk: ORDER3, severity: 1, new: { id: ORDER3, payment_method: 'card', total_amount: 1, created_at: '2026-11-21T11:02:00.000Z' },
        detail: { late_by_seconds: 10800, sent_by: SAM, sent_by_trust: 'pin', flags: ['arrived_late', 'no_staff_on_sale'] },
      })
      expect(describeWho(late, { names })).toEqual({ name: 'Nobody named on the sale', tag: null, trust: 'none' })
      expect(lines(late)).toEqual([
        'The sale itself does not say who rang it. Sam Staff was signed in when it was sent (PIN checked)',
        'Reached the server 3 hours after it was rung — usually a sale taken while the till was offline',
      ])
    })

    it('says when a sale is dated ahead of the server’s clock', () => {
      const entry = row('orders', 'insert', {
        pk: ORDER3, new: { id: ORDER3, staff_id: SAM, payment_method: 'card', total_amount: 1 },
        detail: { late_by_seconds: -7200, rung_by_trust: 'pin', flags: ['arrived_late'] },
      })
      expect(lines(entry)).toEqual(['Dated 2 hours ahead of when it reached the server — the till’s clock may be wrong'])
    })

    it('reads sales filed the earlier way (under whoever sent them) the same', () => {
      // the entry's staff member is who was signed in; the sale names who rang it
      const entry = row('orders', 'insert', {
        pk: ORDER2, via: 'POST /rpc/create_order_with_items',
        new: { id: ORDER2, staff_id: KIM, payment_method: 'cash', total_amount: 7.4, till_id: 'till-1', created_at: '2026-11-21T11:02:00.000Z' },
        detail: { late_by_seconds: 10800, rung_by_trust: 'session_record', flags: ['arrived_late'] },
      })
      expect(describeWho(entry, { names })).toEqual({ name: 'Kim Newstarter', tag: 'matched a sign-in', trust: 'session_record' })
      expect(describeWho(entry).name).toBe('A staff member')
      expect(lines(entry)[0]).toBe('Sent to the server under Sam Staff’s sign-in (PIN checked) — the sale itself names Kim Newstarter as who rang it')

      const noName = row('orders', 'insert', {
        pk: ORDER3, new: { id: ORDER3, payment_method: 'card', total_amount: 1 }, detail: { late_by_seconds: 10800, flags: ['arrived_late', 'no_staff_on_sale'] },
      })
      expect(describeWho(noName, { names }).name).toBe('Nobody named on the sale')
      expect(lines(noName)[0]).toBe('The sale itself does not say who rang it. Sam Staff was signed in when it was sent (PIN checked)')
    })

    it('says when a sale or a line was written straight into the books', () => {
      const direct = row('orders', 'insert', {
        pk: ORDER3, via: 'POST /orders', severity: 2, new: { id: ORDER3, staff_id: SAM, payment_method: 'cash', total_amount: 1 },
        detail: { rung_by_trust: 'pin', flags: ['direct_insert_of_sale'] },
      })
      const line = row('order_items', 'insert', {
        pk: ORDER3, via: 'POST /order_items', severity: 3, new: [{ id: LINE1, product_id: GUINNESS, quantity: 1, unit_price: 0.01 }],
        detail: { lines: { [LINE1]: { product: 'Guinness', list_standard: 7.4, list_member: 6.4, below_list_price: true } }, rows: 1, flags: ['below_list_price', 'direct_insert_of_sale_line'] },
      })
      expect(tags(direct)).toEqual(['Sale written straight into the books, not by the till app'])
      expect(tags(line)).toEqual(['Sold below list price', 'Sale line written straight into the books, not by the till app'])
    })

    it('describes a sale with no staff member on it', () => {
      const entry = row('orders', 'insert', {
        ...nobody, pk: ORDER3, new: { id: ORDER3, payment_method: 'card', total_amount: 1 }, detail: { flags: ['no_staff_on_sale'] },
      })
      expect(title(entry)).toBe('Sale of £1.00 by card')
      expect(tags(entry)).toEqual(['No staff member on the sale'])
      expect(describeWho(entry, { names })).toEqual({ name: 'Nobody named on the sale', tag: null, trust: 'none' })
    })

    it('calls a tab payment a payment when saying who took it', () => {
      const entry = row('orders', 'insert', {
        ...nobody, pk: 'x', via: 'POST /rpc/settle_tab', severity: 1,
        new: { member_id: MO, payment_method: 'cash', total_amount: 3.8, is_tab_settlement: true, status: 'paid' },
        detail: { late_by_seconds: 600, sent_by: SAM, sent_by_trust: 'pin', flags: ['arrived_late', 'no_staff_on_sale'] },
      })
      expect(describeWho(entry, { names }).name).toBe('Nobody named on the payment')
      expect(lines(entry)).toEqual([
        'The payment itself does not say who rang it. Sam Staff was signed in when it was sent (PIN checked)',
        'Reached the server 10 minutes after it was rung — usually a payment taken while the till was offline',
      ])
    })

    it('describes a tab payment (a settlement is stored as a sale)', () => {
      const entry = row('orders', 'insert', {
        pk: 'x', via: 'POST /rpc/settle_tab',
        new: { member_id: MO, payment_method: 'cash', total_amount: 3.8, is_tab_settlement: true, status: 'paid' },
      })
      const d = describeEntry(entry, { names })
      expect(d.title).toBe('Tab payment of £3.80 by cash from Mo Member')
      expect(d.category).toBe('tabs')
    })

    it('describes a void, naming the sale when it is on the page', () => {
      const voided = row('orders', 'update', {
        pk: ORDER1, via: 'PATCH /orders', severity: 1, changed: ['status'], old: { status: 'paid' }, new: { status: 'voided' },
        detail: { flags: ['voided'] },
      })
      expect(title(voided)).toBe('Voided a sale')
      expect(tags(voided)).toEqual(['Voided'])
      const sales = salesIndex([saleEntry()])
      expect(title(voided, { names, sales })).toBe('Voided the sale of £13.80 on tab')
    })

    it('describes an undone tab payment', () => {
      const entry = row('orders', 'update', {
        pk: 'x', via: 'POST /rpc/undo_tab_settlement', changed: ['status'], old: { status: 'paid' }, new: { status: 'voided' },
        detail: { flags: ['voided'] },
      })
      const d = describeEntry(entry, { names })
      expect(d.title).toBe('Undid a tab payment')
      expect(d.category).toBe('tabs')
    })

    it('describes a payment fix and its correction record', () => {
      const fixed = row('orders', 'update', {
        pk: ORDER3, via: 'POST /rpc/correct_order_payment_method', changed: ['payment_method'],
        old: { payment_method: 'card' }, new: { payment_method: 'cash' },
      })
      const correction = row('order_corrections', 'insert', {
        severity: 1, new: { id: 'x', order_id: ORDER3, old_method: 'card', new_method: 'cash', staff_id: SAM },
      })
      expect(title(fixed)).toBe('Changed payment type of a sale from card to cash')
      expect(title(correction)).toBe('Payment type corrected from card to cash')
    })

    it('describes a sale edited directly', () => {
      const entry = row('orders', 'update', {
        pk: ORDER2, via: 'PATCH /orders', severity: 3, changed: ['total_amount'], old: { total_amount: 7.4 }, new: { total_amount: 0.1 },
        detail: { flags: ['direct_edit_of_sale'] },
      })
      expect(title(entry)).toBe('Changed the total of a sale from £7.40 to £0.10')
      expect(tags(entry)).toEqual(['Sale edited directly'])
      expect(lines(entry)).toEqual([])
      // the same edit made through a route the till app never takes
      const d = describeEntry({ ...entry, via: 'POST /rpc/graphql' }, { names })
      expect(d.lines).toEqual(['Made through the database’s GraphQL door, not the till app'])
      expectPlain(d)
    })

    it('describes a sale and a sale line deleted with the service key', () => {
      const sale = row('orders', 'delete', {
        ...nobody, actor: 'service', till_id: null, via: 'DELETE /orders', severity: 2, pk: ORDER3,
        old: { id: ORDER3, payment_method: 'card', total_amount: 1, status: 'paid' },
      })
      const line = row('order_items', 'delete', {
        ...nobody, actor: 'service', severity: 2, old: { id: LINE2, order_id: ORDER3, product_id: CRISPS, quantity: 1, unit_price: 1 },
      })
      expect(title(sale)).toBe('Deleted a sale of £1.00 by card')
      expect(title(line)).toBe('Deleted a sale line: 1 × Crisps at £1.00 each')
    })

    it('ties a later change to a sale’s line back to the sale it is filed under', () => {
      const sales = salesIndex([saleEntry()])
      const deleted = row('order_items', 'delete', {
        ...nobody, actor: 'service', severity: 2, pk: ORDER1, old: { id: LINE2, order_id: ORDER1, product_id: CRISPS, quantity: 1, unit_price: 0.5 },
      })
      const edited = row('order_items', 'update', {
        ...fromDatabase, severity: 2, pk: ORDER1, changed: ['unit_price'], old: { unit_price: 6.4 }, new: { unit_price: 0.01 },
      })
      expect(lines(deleted, { names, sales })).toEqual(['Part of the sale of £13.80 on tab'])
      expect(lines(edited, { names, sales })).toEqual(['Part of the sale of £13.80 on tab'])
      expect(title(edited)).toBe('Changed a sale line: price each from £6.40 to £0.01')
      expect(lines(deleted)).toEqual([])
    })

    it('describes banked staff drinks', () => {
      const banked = row('staff_drink_credits', 'insert', { new: { staff_member_id: SAM, product_id: GUINNESS, amount: 6.4, status: 'banked' } })
      const cancelled = row('staff_drink_credits', 'update', { changed: ['status'], old: { status: 'banked' }, new: { status: 'cancelled' } })
      const poured = row('staff_drink_credits', 'update', {
        changed: ['redeemed_at', 'redeemed_by', 'status'],
        old: { status: 'banked', redeemed_at: null, redeemed_by: null },
        new: { status: 'redeemed', redeemed_at: '2026-11-21T20:00:00.000Z', redeemed_by: KIM },
      })
      expect(title(banked)).toBe('Drink banked for Sam Staff: Guinness (£6.40)')
      expect(title(cancelled)).toBe('Banked staff drink cancelled')
      expect(title(poured)).toBe('Banked staff drink poured')
    })
  })

  describe('stock', () => {
    it('describes wastage with its note', () => {
      const entry = row('stock_movements', 'insert', {
        ...nobody, severity: 1, via: 'POST /stock_movements',
        new: [{ id: 'm1', product_id: GUINNESS, type: 'wastage', quantity: 1, till_id: 'till-1', notes: 'line clean' }],
        detail: { rows: 1 },
      })
      const d = describeEntry(entry, { names })
      expect(d.title).toBe('Wastage: 1 × Guinness')
      expect(d.lines).toEqual(['Note: line clean'])
      expect(d.category).toBe('stock')
    })

    it('describes several movements written together', () => {
      const restock = row('stock_movements', 'insert', {
        new: [
          { id: 'm2', product_id: GUINNESS, type: 'restock', quantity: 2, notes: 'Restored from voided order' },
          { id: 'm3', product_id: CRISPS, type: 'restock', quantity: 1, notes: 'Restored from voided order' },
        ],
        detail: { rows: 2 },
      })
      const mixed = row('stock_movements', 'insert', {
        new: [{ id: 'm4', product_id: CRISPS, type: 'sale', quantity: 1 }, { id: 'm5', product_id: CRISPS, type: 'restock', quantity: 3 }],
        detail: { rows: 2 },
      })
      expect(title(restock)).toBe('Restock: 2 × Guinness, 1 × Crisps')
      expect(lines(restock)).toEqual(['Note: Restored from voided order'])
      expect(title(mixed)).toBe('Stock changes: stock taken for a sale 1 × Crisps, restock 3 × Crisps')
    })

    it('falls back to “an item” when the product name is not known', () => {
      const entry = row('stock_movements', 'insert', { new: [{ id: 'm1', product_id: GUINNESS, type: 'spillage', quantity: 0.5 }] })
      expect(title(entry, {})).toBe('Spillage: 0.5 × an item')
    })
  })

  describe('members and staff', () => {
    it('describes a member added outside the till', () => {
      const entry = row('members', 'insert', {
        ...fromDatabase, severity: 2, pk: SAM, subject: 'Sam Staff',
        new: { id: SAM, name: 'Sam Staff', membership_number: 'S001', membership_tier: 'staff', pin_hash: '[redacted]', email: 'sam@example.test' },
        detail: { flags: ['outside_the_till'] },
      })
      const d = describeEntry(entry, { names })
      expect(d.title).toBe('Added staff member Sam Staff (S001)')
      expect(d.lines).toEqual(['Added with a PIN already set'])
      expect(d.tags).toEqual(['Made outside the till'])
      expect(d.category).toBe('people')
    })

    it('describes a tab balance moving', () => {
      const entry = row('members', 'update', {
        pk: MO, subject: 'Mo Member', via: 'POST /rpc/create_order_with_items',
        changed: ['tab_balance'], old: { tab_balance: 0 }, new: { tab_balance: 13.8 },
      })
      const d = describeEntry(entry, { names })
      expect(d.title).toBe('Mo Member’s tab went from £0.00 to £13.80')
      expect(d.category).toBe('tabs')
    })

    it('marks a balance moved by hand rather than by a sale or a payment', () => {
      const entry = row('members', 'update', {
        pk: MO, subject: 'Mo Member', via: 'POST /rpc/adjust_tab_balance', severity: 1, changed: ['tab_balance'],
        old: { tab_balance: 12 }, new: { tab_balance: 2 }, detail: { flags: ['tab_balance_adjusted'] },
      })
      expect(title(entry)).toBe('Mo Member’s tab went from £12.00 to £2.00')
      expect(tags(entry)).toEqual(['Tab changed without a sale or a payment'])
    })

    it('keeps the tab balance as the headline when a payment also stamps its time', () => {
      const entry = row('members', 'update', {
        pk: MO, subject: 'Mo Member', changed: ['last_settled_at', 'tab_balance'],
        old: { tab_balance: 13.8, last_settled_at: null }, new: { tab_balance: 10, last_settled_at: '2026-11-21T14:02:00.000Z' },
      })
      expect(title(entry)).toBe('Mo Member’s tab went from £13.80 to £10.00')
    })

    it('describes a balance edited directly', () => {
      const entry = row('members', 'update', {
        pk: MO, subject: 'Mo Member', via: 'PATCH /members', severity: 3,
        changed: ['tab_balance'], old: { tab_balance: 11 }, new: { tab_balance: 0 },
        detail: { flags: ['direct_edit_of_protected_field'] },
      })
      expect(title(entry)).toBe('Mo Member’s tab went from £11.00 to £0.00')
      expect(tags(entry)).toEqual(['Protected figure edited directly'])
    })

    it('describes ordinary edits', () => {
      const phone = row('members', 'update', {
        pk: MO, subject: 'Mo Member', changed: ['phone'], old: { phone: '07700 900123' }, new: { phone: '07700 900999' },
      })
      const several = row('members', 'update', {
        pk: MO, subject: 'Mo Member', changed: ['email', 'phone'],
        old: { email: 'mo@example.test', phone: '1' }, new: { email: 'mo2@example.test', phone: '2' },
      })
      expect(title(phone)).toBe('Changed Mo Member’s phone number from 07700 900123 to 07700 900999')
      expect(title(several)).toBe('Changed Mo Member: email, phone number')
      expect(lines(several)).toEqual(['Email from mo@example.test to mo2@example.test', 'Phone number from 1 to 2'])
    })

    it('describes someone being made staff, and taken off', () => {
      const promoted = row('members', 'update', {
        pk: MO, subject: 'Mo Member', severity: 2, changed: ['membership_tier'],
        old: { membership_tier: 'member' }, new: { membership_tier: 'staff' }, detail: { flags: ['tier_changed'] },
      })
      const demoted = row('members', 'update', {
        pk: MO, subject: 'Mo Member', severity: 2, changed: ['membership_tier'],
        old: { membership_tier: 'staff' }, new: { membership_tier: 'member' }, detail: { flags: ['tier_changed'] },
      })
      expect(title(promoted)).toBe('Made Mo Member a staff member')
      expect(tags(promoted)).toEqual(['Staff status changed'])
      expect(title(demoted)).toBe('Took Mo Member off the staff list')
    })

    it('says PIN set / changed / cleared and never shows the stored value', () => {
      const set = row('members', 'update', {
        pk: KIM, subject: 'Kim Newstarter', changed: ['pin_hash'], old: { pin_hash: null }, new: { pin_hash: '[redacted]' },
        detail: { flags: ['pin_changed'] },
      })
      const changed = row('members', 'update', {
        pk: KIM, subject: 'Kim Newstarter', changed: ['pin_hash'], old: { pin_hash: '[redacted]' }, new: { pin_hash: '[redacted]' },
      })
      const cleared = row('members', 'update', {
        pk: KIM, subject: 'Kim Newstarter', changed: ['pin_hash'], old: { pin_hash: '[redacted]' }, new: { pin_hash: null },
      })
      const withOthers = row('members', 'update', {
        pk: KIM, subject: 'Kim Newstarter', changed: ['email', 'pin_hash'],
        old: { email: null, pin_hash: null }, new: { email: 'kim@example.test', pin_hash: '[redacted]' },
      })
      expect(title(set)).toBe('PIN set for Kim Newstarter')
      expect(tags(set)).toEqual(['PIN changed'])
      expect(title(changed)).toBe('PIN changed for Kim Newstarter')
      expect(title(cleared)).toBe('PIN cleared for Kim Newstarter')
      expect(lines(withOthers)).toEqual(['Email from — to kim@example.test', 'PIN set'])
      for (const entry of [set, changed, cleared, withOthers]) {
        expect(JSON.stringify(describeEntry(entry, { names }))).not.toMatch(/redacted|pin_hash/i)
      }
    })

    it('describes deactivating, app logins and deleting', () => {
      const off = row('members', 'update', { pk: MO, subject: 'Mo Member', changed: ['active'], old: { active: true }, new: { active: false } })
      const linked = row('members', 'update', {
        pk: MO, subject: 'Mo Member', changed: ['auth_user_id'], old: { auth_user_id: null }, new: { auth_user_id: 'a0000000-0000-0000-0000-0000000000aa' },
      })
      const deleted = row('members', 'delete', { pk: KIM, subject: null, old: { id: KIM, name: 'Kim Newstarter', membership_tier: 'staff' } })
      expect(title(off)).toBe('Made Mo Member inactive')
      expect(title(linked)).toBe('Linked an app login to Mo Member')
      expect(title(deleted)).toBe('Deleted staff member Kim Newstarter')
    })

    it('copes with a member whose details were erased', () => {
      const entry = row('members', 'update', { pk: MO, subject: null, changed: ['name'], old: { name: '[erased]' }, new: { name: '[erased]' } })
      expect(title(entry, {})).toBe('Changed the name of a member whose details were since erased')
      const tab = row('members', 'update', { pk: MO, subject: null, changed: ['tab_balance'], old: { tab_balance: 1 }, new: { tab_balance: 2 } })
      expect(title(tab, {})).toBe('A member’s tab went from £1.00 to £2.00')
    })

    it('describes a guest sign-in', () => {
      const entry = row('guest_signins', 'insert', { new: { id: 'g1', guest_name: 'A Guest', member_id: MO, staff_id: SAM, till_id: 'till-1' } })
      expect(title(entry)).toBe('Guest A Guest signed in by Mo Member')
    })

    it('describes wrong-PIN counts kept by the older sign-in service', () => {
      const counted = row('pin_attempts', 'insert', {
        ...nobody, actor: 'service', via: 'fn:verify-pin POST /pin_attempts', severity: 1, pk: KIM,
        new: { member_id: KIM, failed_count: 1, locked_until: null },
      })
      const locked = row('pin_attempts', 'update', {
        pk: SAM, changed: ['failed_count', 'locked_until'], old: { failed_count: 4, locked_until: null },
        new: { failed_count: 0, locked_until: '2026-11-21T14:17:00.000Z' },
      })
      const cleared = row('pin_attempts', 'delete', { pk: KIM, old: { member_id: KIM, failed_count: 1 } })
      expect(title(counted)).toBe('Wrong PIN counted for Kim Newstarter (1 wrong try so far)')
      expect(title(locked)).toMatch(/^PIN locked for Sam Staff until \d\d:\d\d$/)
      expect(title(cleared)).toBe('Wrong-PIN count cleared for Kim Newstarter')
      expect(describeEntry(counted, { names }).category).toBe('signin')
    })
  })

  describe('promotions', () => {
    it('describes promotions and what is in them', () => {
      const added = row('promotions', 'insert', { pk: PROMO, new: { id: PROMO, name: 'Happy hour', active: true } })
      const off = row('promotions', 'update', { pk: PROMO, changed: ['active'], old: { active: true }, new: { active: false } })
      const item = row('promotion_items', 'insert', {
        new: { id: 'pi', promotion_id: PROMO, product_id: GUINNESS, discount_type: 'fixed_price', discount_value: 5 },
      })
      const itemGone = row('promotion_items', 'delete', {
        old: { id: 'pi', promotion_id: PROMO, product_id: GUINNESS, discount_type: 'fixed_price', discount_value: 5 },
      })
      const category = row('promotion_categories', 'insert', {
        new: { id: 'pc', promotion_id: PROMO, category: 'draught', discount_type: 'percentage', discount_value: 20 },
      })
      const deleted = row('promotions', 'delete', { pk: PROMO, old: { id: PROMO, name: 'Happy hour' }, severity: 2 })
      expect(title(added)).toBe('Added promotion “Happy hour”')
      expect(title(off)).toBe('Switched off promotion “Happy hour”')
      expect(title(off, {})).toBe('Switched off a promotion')
      expect(title(item)).toBe('Added Guinness to promotion “Happy hour” at a fixed price of £5.00')
      expect(title(itemGone)).toBe('Took Guinness out of promotion “Happy hour”')
      expect(title(category)).toBe('Added all draught products to promotion “Happy hour” at 20% off')
      expect(title(deleted)).toBe('Deleted promotion “Happy hour”')
    })
  })

  describe('tabs and cash', () => {
    it('describes tab adjustments', () => {
      const less = row('tab_adjustments', 'insert', { severity: 1, new: { id: 't', member_id: MO, amount: -1, reason: 'test', staff_id: SAM } })
      const more = row('tab_adjustments', 'insert', { severity: 1, new: { id: 't', member_id: MO, amount: 2.5, reason: 'missed drink', staff_id: SAM } })
      expect(title(less)).toBe('Took £1.00 off Mo Member’s tab — reason: test')
      expect(title(more)).toBe('Added £2.50 to Mo Member’s tab — reason: missed drink')
      expect(describeEntry(less, { names }).category).toBe('tabs')
    })

    it('describes cashback, prize payouts and online tab payments', () => {
      const cashback = row('cashback_transactions', 'insert', { severity: 1, new: { id: 'c', amount: 20, staff_id: SAM, till_id: 'till-1' } })
      const prize = row('prize_wins', 'insert', { severity: 1, new: { id: 'p', amount: 20, machine: 'Fruit machine', staff_id: SAM } })
      const online = row('tab_payments', 'insert', {
        ...nobody, actor: 'service', new: { id: 'tp', member_id: MO, amount: 20, stripe_payment_intent_id: 'pi_123' },
      })
      expect(title(cashback)).toBe('Cashback of £20.00 given from the till')
      expect(title(prize)).toBe('Prize payout of £20.00 (Fruit machine)')
      expect(title(online)).toBe('Online tab payment of £20.00 from Mo Member')
    })

    it('describes closing the day and changing its figures', () => {
      const closed = row('z_reports', 'insert', {
        new: { id: 'z', report_date: '2026-11-21', opening_float: 300, actual_cash: 512.4, closed_at: '2026-11-21T23:10:00.000Z' },
      })
      const changed = row('z_reports', 'update', {
        changed: ['actual_cash', 'closed_at'],
        old: { actual_cash: 512.4, closed_at: '2026-11-21T23:10:00.000Z' }, new: { actual_cash: 500, closed_at: '2026-11-21T23:20:00.000Z' },
      })
      expect(title(closed)).toBe('Day closed for Sat 21 Nov: opening float £300.00, cash counted £512.40')
      expect(title(changed)).toBe('Day close figures changed: cash counted from £512.40 to £500.00')
    })
  })

  describe('the system’s own lists', () => {
    it('describes till registrations and report email lists', () => {
      const till = row('till_devices', 'insert', {
        ...fromDatabase, severity: 3, pk: '37e48d38-694b-4e84-81c0-d37963a2e1e6',
        new: { auth_user_id: '37e48d38-694b-4e84-81c0-d37963a2e1e6', till_id: 'till-2', name: 'Second' },
        detail: { flags: ['outside_the_till', 'till_registration_changed'] },
      })
      const added = row('z_report_recipients', 'insert', {
        ...fromDatabase, severity: 2, new: { id: 'r', email: 'boss@example.test', active: true }, detail: { flags: ['report_recipients_changed'] },
      })
      const removed = row('monthly_report_recipients', 'delete', { ...fromDatabase, severity: 2, old: { id: 'r', email: 'boss@example.test' } })
      const d = describeEntry(till, { names })
      expect(d.title).toBe('Till registered: Second (Till 2)')
      expect(d.tags).toEqual(['Made outside the till', 'Till registration changed'])
      expect(title(added)).toBe('Added boss@example.test to the day-close email list')
      expect(tags(added)).toEqual(['Report email list changed'])
      expect(title(removed)).toBe('Removed boss@example.test from the monthly report email list')
    })

    it('describes suppliers', () => {
      expect(title(row('suppliers', 'insert', { new: { id: 's', name: 'Brewery Ltd' } }))).toBe('Added supplier Brewery Ltd')
      expect(title(row('suppliers', 'delete', { old: { id: 's', name: 'Brewery Ltd' } }))).toBe('Deleted supplier Brewery Ltd')
    })

    it('describes a whole list being wiped', () => {
      const entry = row('orders', 'truncate', { ...fromDatabase, severity: 3, detail: { flags: ['table_emptied'] } })
      expect(title(entry)).toBe('Every one of the sales was wiped in one go')
      expect(tags(entry)).toEqual(['Everything wiped at once'])
    })
  })

  it('falls back to a readable sentence for a list it has never heard of', () => {
    const changed = row('purchase_orders', 'update', {
      pk: 'po1', changed: ['status', 'supplier_id'],
      old: { status: 'draft', supplier_id: '5a000000-0000-0000-0000-00000000ffff' },
      new: { status: 'sent', supplier_id: '5a000000-0000-0000-0000-00000000eeee' },
    })
    const d = describeEntry(changed, { names })
    expect(d.title).toBe('Changed a purchase order: status, supplier')
    expect(d.lines).toEqual(['Status from draft to sent', 'Supplier changed'])
    expect(d.category).toBe('other')
    expect(title(row('purchase_orders', 'insert', { new: { id: 'po1' } }))).toBe('Added a purchase order')
    expect(title(row('purchase_orders', 'delete', { old: { id: 'po1' } }))).toBe('Deleted a purchase order')
    expect(title(row('tabs', 'insert', { new: [{ id: 1 }, { id: 2 }] }))).toBe('Added 2 tabs')
  })
})

describe('describeEntry — sign-ins and PINs (kind: auth)', () => {
  const cases = [
    ['staff.sign_in', auth('staff.sign_in', SAM, 'Sam Staff', { trust: 'pin' }), 'Sam Staff signed in'],
    ['staff.sign_out', auth('staff.sign_out', SAM, 'Sam Staff', { reason: 'sign_out' }), 'Sam Staff signed out'],
    ['staff.sign_out (switch user)', auth('staff.sign_out', SAM, 'Sam Staff', { reason: 'switch_user' }), 'Sam Staff signed out (switched to someone else)'],
    ['staff.sign_out (idle lock)', auth('staff.sign_out', SAM, 'Sam Staff', { reason: 'idle_lock' }), 'Sam Staff was signed out when the till locked itself'],
    ['staff.sign_out (manual lock)', auth('staff.sign_out', SAM, 'Sam Staff', { reason: 'manual_lock' }), 'Sam Staff was signed out when the till was locked with the Lock button'],
    ['staff.sign_out (PIN accepted too late)', auth('staff.sign_out', SAM, 'Sam Staff', { reason: 'unused_unlock' }), 'Sam Staff was signed out again straight away — their PIN was accepted too late to unlock the till'],
    ['staff.sign_out (a reason it has never heard of)', auth('staff.sign_out', SAM, 'Sam Staff', { reason: 'fire_drill' }), 'Sam Staff signed out (fire drill)'],
    ['staff.sign_out (close day)', auth('staff.sign_out', SAM, 'Sam Staff', { reason: 'close_day' }), 'Sam Staff was signed out when the day was closed'],
    ['staff.sign_out (replaced)', auth('staff.sign_out', SAM, 'Sam Staff', { reason: 'replaced' }), 'Sam Staff was signed out because someone else signed in on that till'],
    ['pin.wrong_pin', auth('pin.wrong_pin', SAM, 'Sam Staff', { purpose: 'sign_in', attempts_remaining: 3 }, { ...nobody, severity: 1 }), 'Wrong PIN for Sam Staff — 3 tries left'],
    ['pin.wrong_pin (last try)', auth('pin.wrong_pin', SAM, 'Sam Staff', { purpose: 'sign_in', attempts_remaining: 1 }, nobody), 'Wrong PIN for Sam Staff — 1 try left'],
    ['pin.locked_now', auth('pin.locked_now', SAM, 'Sam Staff', { purpose: 'sign_in', attempts_remaining: null }, { ...nobody, severity: 2 }), 'Too many wrong PINs for Sam Staff — locked for 15 minutes'],
    ['pin.locked', auth('pin.locked', SAM, 'Sam Staff', { purpose: 'sign_in' }, { ...nobody, severity: 2 }), 'PIN tried for Sam Staff while it was locked'],
    ['pin.no_pin', auth('pin.no_pin', KIM, 'Kim Newstarter', { purpose: 'sign_in' }, nobody), 'PIN tried for Kim Newstarter, who has no PIN yet'],
    ['pin.not_staff', auth('pin.not_staff', MO, 'Mo Member', { purpose: 'sign_in' }, { ...nobody, severity: 2 }), 'PIN tried for Mo Member, who is not staff'],
    ['pin.confirmed (z_report)', auth('pin.confirmed', KIM, 'Kim Newstarter', { purpose: 'z_report', for_signed_in_person: true }), 'Kim Newstarter confirmed their PIN for the Z report'],
    ['pin.confirmed (price_change)', auth('pin.confirmed', KIM, 'Kim Newstarter', { purpose: 'price_change', for_signed_in_person: true }), 'Kim Newstarter confirmed their PIN for a price change'],
    ['pin.confirmed (fix_payment)', auth('pin.confirmed', KIM, 'Kim Newstarter', { purpose: 'fix_payment' }), 'Kim Newstarter confirmed their PIN for fixing a payment'],
    ['pin.confirmed (undo_tab_payment)', auth('pin.confirmed', KIM, 'Kim Newstarter', { purpose: 'undo_tab_payment' }), 'Kim Newstarter confirmed their PIN for undoing a tab payment'],
    ['pin.confirmed (unlock)', auth('pin.confirmed', KIM, 'Kim Newstarter', { purpose: 'unlock' }), 'Kim Newstarter confirmed their PIN for unlocking the till'],
    ['pin.confirmed (something new)', auth('pin.confirmed', KIM, 'Kim Newstarter', { purpose: 'refund_order' }), 'Kim Newstarter confirmed their PIN for refund order'],
    ['pin.first_set', auth('pin.first_set', KIM, 'Kim Newstarter', { set_by_self: false }, { severity: 2 }), 'First PIN set for Kim Newstarter'],
    ['pin.changed', auth('pin.changed', KIM, 'Kim Newstarter', { set_by_self: true }, { severity: 1 }), 'PIN changed for Kim Newstarter'],
    ['session.claim_refused', auth('session.claim_refused', SAM, 'Sam Staff', { note: 'x' }, { ...nobody, severity: 2 }), 'Refused: a till tried to mark Sam Staff as signed in without the PIN being checked'],
    ['an auth entry it has never heard of', auth('pin.something_else', SAM, 'Sam Staff', {}), 'Sign-in activity for Sam Staff: pin something else'],
  ]

  it.each(cases)('%s', (_name, entry, expected) => {
    const d = describeEntry(entry, { names })
    expect(d.title).toBe(expected)
    expect(d.category).toBe('signin')
    expectPlain(d)
  })

  it('explains a sign-in the database could not check itself', () => {
    const entry = auth('staff.sign_in', SAM, 'Sam Staff', { trust: 'claimed' }, { staff_trust: 'claimed', severity: 1 })
    expect(lines(entry)).toEqual(['The PIN was checked the older way, so the log can only say this person is “said to be” who signed in'])
  })

  it('says what a wrong PIN was being asked for', () => {
    const entry = auth('pin.wrong_pin', SAM, 'Sam Staff', { purpose: 'z_report', attempts_remaining: 4, for_signed_in_person: true })
    expect(lines(entry)).toEqual(['The PIN was being asked for the Z report'])
  })

  it('describes a wrong current PIN during a PIN change', () => {
    const entry = auth('pin.wrong_pin', KIM, 'Kim Newstarter', { purpose: 'change_pin' }, { severity: 2 })
    expect(title(entry)).toBe('Wrong current PIN given while trying to change Kim Newstarter’s PIN')
  })

  it('says who was signed in when a PIN was set for, or confirmed as, someone else', () => {
    const firstSet = auth('pin.first_set', KIM, 'Kim Newstarter', { set_by_self: false }, { severity: 2 })
    const confirmed = auth('pin.confirmed', KIM, 'Kim Newstarter', { purpose: 'price_change', for_signed_in_person: false })
    expect(lines(firstSet)).toEqual(['Sam Staff was signed in when it was set'])
    expect(lines(confirmed)).toEqual(['Sam Staff was the person signed in at the time'])
  })

  it('explains that a lock ends the sign-in', () => {
    const line = 'A lock ends the sign-in. Unlocking with a PIN is a fresh sign-in.'
    expect(lines(auth('staff.sign_out', SAM, 'Sam Staff', { reason: 'idle_lock' }))).toEqual([line])
    expect(lines(auth('staff.sign_out', SAM, 'Sam Staff', { reason: 'manual_lock' }))).toEqual([line])
    expect(lines(auth('staff.sign_out', SAM, 'Sam Staff', { reason: 'sign_out' }))).toEqual([])
  })

  it('says what a locked PIN was being asked for', () => {
    const entry = auth('pin.locked', SAM, 'Sam Staff', { purpose: 'unlock', for_signed_in_person: true }, { severity: 2 })
    expect(lines(entry)).toEqual(['The PIN was being asked for unlocking the till'])
  })

  it('falls back when the person’s name is not known', () => {
    expect(title(auth('staff.sign_in', SAM, null, { trust: 'pin' }), {})).toBe('A staff member signed in')
    expect(title(auth('pin.not_staff', MO, null, {}), {})).toBe('PIN tried for someone who is not staff')
  })
})

describe('describeEntry — blocked attempts to rewrite history (kind: guard)', () => {
  it('describes a blocked delete of a sale', () => {
    const entry = guard('blocked.delete', 'orders', {
      pk: ORDER2, via: 'DELETE /orders', old: { id: ORDER2, payment_method: 'cash', total_amount: 7.4, status: 'paid' },
      detail: { rule: 'no_delete', flags: ['history_rewrite_attempt'] },
    })
    const d = describeEntry(entry, { names })
    expect(d.title).toBe('Blocked: an attempt to delete a sale of £7.40 by cash directly')
    expect(d.lines).toEqual(['Nothing was changed. The till app never does this, so it is worth asking who did.'])
    expect(d.tags).toEqual(['Attempt to change past records'])
    expect(d.category).toBe('blocked')
  })

  it('describes a blocked edit and what was attempted', () => {
    const entry = guard('blocked.update', 'order_items', {
      ...nobody, pk: LINE1, via: 'PATCH /order_items',
      old: { id: LINE1, order_id: ORDER2, product_id: GUINNESS, quantity: 1, unit_price: 7.4 },
      new: { id: LINE1, order_id: ORDER2, product_id: GUINNESS, quantity: 1, unit_price: 0.01 },
    })
    const d = describeEntry(entry, { names })
    expect(d.title).toBe('Blocked: an attempt to edit a sale line (1 × Guinness at £7.40 each) directly')
    expect(d.lines[0]).toBe('Tried to change price each from £7.40 to £0.01')
  })

  it('describes a delete that went through in watch-only mode', () => {
    const entry = guard('would_block.delete', 'tab_adjustments', {
      pk: 't', via: 'DELETE /tab_adjustments', old: { id: 't', member_id: MO, amount: 1, reason: 'test' },
    })
    const d = describeEntry(entry, { names })
    expect(d.title).toBe('Allowed, but should not happen: a tab adjustment of £1.00 (test) was deleted directly')
    expect(d.lines).toEqual(['Protection of past records was in watch-only mode, so this went through.'])
  })

  it('describes an edit that went through in watch-only mode', () => {
    const entry = guard('would_block.update', 'stock_movements', {
      old: { id: 'm', product_id: GUINNESS, type: 'wastage', quantity: 1 }, new: { id: 'm', product_id: GUINNESS, type: 'wastage', quantity: 9 },
    })
    expect(title(entry)).toBe('Allowed, but should not happen: a stock record (wastage 1 × Guinness) was edited directly')
  })

  it('describes blocked deletes of members, products and day closes without showing a PIN value', () => {
    const member = guard('blocked.delete', 'members', {
      pk: KIM, subject: 'Kim Newstarter', old: { id: KIM, name: 'Kim Newstarter', membership_tier: 'staff', pin_hash: '[redacted]' },
    })
    const product = guard('blocked.delete', 'products', { pk: CRISPS, subject: 'Crisps', old: { id: CRISPS, name: 'Crisps' } })
    const day = guard('blocked.delete', 'z_reports', { old: { id: 'z', report_date: '2026-11-21' } })
    expect(title(member)).toBe('Blocked: an attempt to delete staff member Kim Newstarter directly')
    expect(JSON.stringify(describeEntry(member, { names }))).not.toMatch(/redacted/)
    expect(title(product)).toBe('Blocked: an attempt to delete product Crisps directly')
    expect(title(day)).toBe('Blocked: an attempt to delete the day close for Sat 21 Nov directly')
  })
})

describe('describeEntry — refused writes to a member’s protected details (kind: guard)', () => {
  const protectedGuard = (action, changed, old, next, extra = {}) => guard(action, 'members', {
    pk: SAM, subject: 'Sam Staff', via: 'PATCH /members', changed, old, new: next,
    detail: { rule: 'protected_fields', flags: ['direct_edit_of_protected_field'] }, ...extra,
  })

  it('reads as refused, never as if it happened', () => {
    const entry = protectedGuard('blocked.update', ['pin_hash'], { pin_hash: '[redacted]' }, { pin_hash: '[redacted]' })
    const d = describeEntry(entry, { names })
    expect(d.title).toBe('Tried to change Sam Staff’s PIN directly — refused')
    expect(d.lines).toEqual([
      'Tried to replace the PIN — whoever sets someone’s PIN can sign in as them',
      'Refused: it was put back as it was. The till app only changes this through its own steps, so it is worth asking who tried.',
    ])
    // the same flag on a refused attempt must not read as if the edit happened
    expect(d.tags).toEqual(['Direct edit of a protected figure refused'])
    expect(d.category).toBe('blocked')
    expect(JSON.stringify(d)).not.toMatch(/redacted/)
    for (const text of [d.title, ...d.lines]) expect(text).not.toMatch(/\b(PIN changed|PIN set for|changed for)\b/)
    expectPlain(d)
  })

  it('names every field that was tried, with the figures', () => {
    const entry = protectedGuard('blocked.update', ['auth_user_id', 'last_settled_at', 'pin_hash', 'tab_balance'],
      { auth_user_id: KIM, last_settled_at: '2026-11-20T10:00:00.000Z', pin_hash: null, tab_balance: 42.5 },
      { auth_user_id: null, last_settled_at: '2026-11-21T10:00:00.000Z', pin_hash: '[redacted]', tab_balance: 0 },
      { pk: MO, subject: 'Mo Member' })
    const d = describeEntry(entry, { names })
    expect(d.title).toBe('Tried to change Mo Member’s app login, last tab payment time, PIN and tab balance directly — refused')
    expect(d.lines.slice(0, 4)).toEqual([
      'Tried to remove the app login',
      'Tried to change the time of the last tab payment',
      'Tried to set a PIN — whoever sets someone’s PIN can sign in as them',
      'Tried to change the tab balance from £42.50 to £0.00',
    ])
    expectPlain(d)
    expectPlain(describeEntry({ ...entry, subject: null }, {}))
    expect(title({ ...entry, subject: null }, {})).toMatch(/^Tried to change a member’s app login/)
  })

  it('says so plainly when watch-only mode let it through', () => {
    const entry = protectedGuard('would_block.update', ['tab_balance'], { tab_balance: 42.5 }, { tab_balance: 0 }, { pk: MO, subject: 'Mo Member' })
    const d = describeEntry(entry, { names })
    expect(d.title).toBe('Allowed, but should not happen: Mo Member’s tab balance was changed directly')
    expect(d.lines).toEqual([
      'The tab balance went from £42.50 to £0.00',
      'Protection of past records was in watch-only mode, so this went through.',
    ])
    expect(d.tags).toEqual(['Protected figure edited directly'])
  })

  it('says when an attempt came through the GraphQL door', () => {
    const pin = protectedGuard('blocked.update', ['pin_hash'], { pin_hash: '[redacted]' }, { pin_hash: '[redacted]' }, { via: 'POST /rpc/graphql' })
    expect(lines(pin)[1]).toBe('It came through the database’s GraphQL door, which the till app does not use.')
    const sale = guard('blocked.delete', 'orders', {
      pk: ORDER2, via: 'POST /rpc/graphql', old: { id: ORDER2, payment_method: 'cash', total_amount: 7.4, status: 'paid' },
      detail: { rule: 'no_delete', flags: ['history_rewrite_attempt'] },
    })
    expect(lines(sale)).toEqual([
      'It came through the database’s GraphQL door, which the till app does not use.',
      'Nothing was changed. The till app never does this, so it is worth asking who did.',
    ])
  })

  it('ties a refused attempt on a sale line back to its sale', () => {
    // filed under the order (pk), like the lines themselves
    const entry = guard('blocked.update', 'order_items', {
      pk: ORDER1, via: 'PATCH /order_items',
      old: { id: LINE1, order_id: ORDER1, product_id: GUINNESS, quantity: 2, unit_price: 6.4 },
      new: { id: LINE1, order_id: ORDER1, product_id: GUINNESS, quantity: 2, unit_price: 0.01 },
    })
    expect(lines(entry, { names, sales: salesIndex([saleEntry()]) })).toEqual([
      'Tried to change price each from £6.40 to £0.01',
      'Part of the sale of £13.80 on tab',
      'Nothing was changed. The till app never does this, so it is worth asking who did.',
    ])
  })
})

describe('describeEntry — the log’s own housekeeping (kind: system)', () => {
  const cron = { ...nobody, actor: 'database', till_id: null, via: 'cron:audit-nightly' }
  const cases = [
    ['auditlog.installed', system('auditlog.installed', { rows_at_install: { orders: 10 }, note: 'Recording starts here.' }, { ...fromDatabase, severity: 1 }), 'Recording started here — nothing before this entry was captured'],
    ['audit.installed', system('audit.installed', {}, fromDatabase), 'Recording started here — nothing before this entry was captured'],
    ['device.new_address', system('device.new_address', { ip: '203.0.113.10', user_agent: 'TestBrowser/1.0', app_build: 'test123' }, { ...nobody, severity: 2 }), 'Till 1 was seen from a network address it has not used before (203.0.113.10)'],
    ['integrity.ok', system('integrity.ok', { ok: true, rows_checked: 1234, seals_checked: 12, problems: [] }, cron), 'Nightly check passed: all 1234 entries intact'],
    ['integrity.checked', system('integrity.checked', { ok: true, rows_checked: 1234, problems: [] }), 'Check run by hand: passed — all 1234 entries intact'],
    ['integrity.witness_mismatch', system('integrity.witness_mismatch', { seal: 5, remembered_hash: '0'.repeat(64), note: 'x' }, { ...nobody, severity: 3 }), 'Till 1 remembered a seal the database no longer has'],
    ['coverage.gap', system('coverage.gap', { tables: 22, missing: ['order_items:insert'], disabled: ['orders'] }, { ...cron, severity: 3 }), 'Part of the recording is missing or has been switched off'],
    ['capture.failures', system('capture.failures', { last_24h: 5 }, { ...cron, severity: 2 }), '5 changes could not be recorded in the last 24 hours'],
    ['log.viewed', system('log.viewed', { filter: {} }), 'Opened the log'],
    ['alert.checked', system('alert.checked', { note: 'looked into it' }, { pk: '57' }), 'Marked alert number 57 as checked'],
    ['privacy.erased', system('privacy.erased', { entries: 3, reason: 'erasure request' }, { ...fromDatabase, table: 'members', pk: MO, subject: 'Mo Member', severity: 2 }), 'Personal details erased from the log for Mo Member (3 entries)'],
    ['a system entry it has never heard of', system('seal.rotated', {}), 'Log housekeeping: seal rotated'],
  ]

  it.each(cases)('%s', (_name, entry, expected) => {
    const d = describeEntry(entry, { names })
    expect(d.title).toBe(expected)
    expect(d.category).toBe('system')
    expectPlain(d)
  })

  it('spells out each problem when a check fails', () => {
    const entry = system('integrity.FAILED', {
      ok: false,
      problems: [
        { seal: 3, problem: 'row_content_changed', seq: 57 },
        { seal: 4, problem: 'row_count_changed', expected: 50, found: 49 },
      ],
    }, { severity: 3 })
    const d = describeEntry(entry, { names })
    expect(d.title).toBe('CHECK FAILED: the log has been tampered with or damaged (2 problems)')
    expect(d.lines).toEqual([
      'Entry number 57 has been altered since it was recorded (sealed batch 3).',
      'Sealed batch 4 should hold 50 entries but now holds 49 — entries have been removed or added.',
    ])
  })

  it('says what is not being recorded when there is a gap', () => {
    const entry = system('coverage.gap', { missing: ['order_items:insert', 'tabs'], disabled: ['orders', 'auditlog.log:append_only'] }, { severity: 3 })
    expect(lines(entry)).toEqual([
      'Not being recorded: new sale lines, tabs',
      'Recording has been switched off for: sales',
      'Protection has been switched off: the lock on the log itself',
    ])
  })

  it('says when a protection is gone or has been pointed at other code', () => {
    const entry = system('coverage.gap', {
      tables: 22, missing: ['orders:guard'], disabled: ['members:protected_fields'], repointed: ['products:truncate', 'auditlog.log:append_only'], note: 'x',
    }, { severity: 3 })
    const d = describeEntry(entry, { names })
    expect(d.title).toBe('Part of the recording is missing, switched off or redirected')
    expect(d.lines).toEqual([
      'Protection is missing: the guard on sales',
      'Protection has been switched off: the guard on PINs, tab balances and app logins',
      'Redirected away from the log’s own code: products being wiped all at once, the lock on the log itself',
    ])
    expectPlain(d)
  })

  it('says how much of the log a check covered', () => {
    const recent = system('integrity.checked', { ok: true, scope: 'recent', since: '2026-10-22T12:00:00.000Z', seals_checked: 9000, seals_rehashed: 800, rows_checked: 31000, problems: [] })
    expect(title(recent)).toBe('Check run by hand: passed — every seal checked, and all 31000 entries since Thu 22 Oct intact')
    expect(lines(recent)).toEqual(['Older entries were not re-read this time; the nightly check covers them.'])
    const whole = system('integrity.ok', { ok: true, scope: 'everything', since: null, seals_checked: 12, seals_rehashed: 12, rows_checked: 1234, problems: [] })
    expect(title(whole)).toBe('Nightly check passed: all 1234 entries intact')
    expect(lines(whole)).toEqual([])
    const failed = system('integrity.FAILED', { ok: false, scope: 'recent', since: '2026-10-22T12:00:00.000Z', problems: [{ problem: 'erased_without_record', rows: 2, seq: 40 }] }, { severity: 3 })
    expect(lines(failed)).toEqual([
      '2 entries have been blanked as if for a privacy request, but no such request was recorded (the first is entry number 40).',
      'Older entries were not re-read this time; the nightly check covers them.',
    ])
  })

  it('explains the two entries about the log’s own code', () => {
    const changed = describeEntry(system('coverage.changed', { note: 'The audit layer\'s own code no longer matches the accepted version.' }, { severity: 3 }), { names })
    expect(changed.title).toBe('The log’s own recording code has been changed since it was last accepted')
    expect(changed.lines).toHaveLength(1)
    expect(changed.category).toBe('system')
    expectPlain(changed)

    const accepted = describeEntry(system('manifest.accepted', { digest: 'd41d8cd98f00b204e9800998ecf8427e', reason: 'audit log: review fixes', note: 'x' }, { ...fromDatabase, severity: 2 }), { names })
    expect(accepted.title).toBe('The log’s recording code was accepted as genuine')
    expect(accepted.lines[0]).toBe('Reason given: audit log: review fixes')
    expect(accepted.lines).toHaveLength(2)
    expectPlain(accepted)
  })

  it('says which of the log’s own settings changed', () => {
    const watchOnly = system('settings.changed', { note: 'x' }, {
      ...fromDatabase, severity: 3,
      old: { id: true, capture_enabled: true, guards_enforced: true, session_max_hours: 24 },
      new: { id: true, capture_enabled: true, guards_enforced: false, session_max_hours: 24 },
    })
    const off = system('settings.changed', {}, {
      ...fromDatabase, severity: 3,
      old: { id: true, capture_enabled: true, guards_enforced: true, session_max_hours: 24 },
      new: { id: true, capture_enabled: false, guards_enforced: true, session_max_hours: 12 },
    })
    expect(title(watchOnly)).toBe('The log’s own settings were changed: protection of past records put in watch-only mode')
    expect(title(off)).toBe('The log’s own settings were changed: RECORDING SWITCHED OFF; longest sign-in changed from 24 to 12 hours')
  })

  it('adds the note on a checked alert and what was searched for', () => {
    expect(lines(system('alert.checked', { note: 'looked into it' }, { pk: '57' }))).toEqual(['Note: looked into it'])
    expect(lines(system('log.viewed', { filter: { q: 'guinness' } }))).toEqual(['Searched for “guinness”'])
    expect(lines(system('log.viewed', { filter: { table: 'products', pk: GUINNESS } }))).toEqual(['Looked at the history of one product'])
    expect(lines(system('privacy.erased', { entries: 3, reason: 'erasure request' }, { table: 'members', pk: MO }))).toEqual(['Reason: erasure request'])
  })
})

describe('describeProblem and coverageLabel', () => {
  it('puts every kind of integrity problem into words', () => {
    expect(describeProblem({ seal: 3, problem: 'row_content_changed', seq: 57 })).toBe('Entry number 57 has been altered since it was recorded (sealed batch 3).')
    expect(describeProblem({ seal: 4, problem: 'row_count_changed', expected: 50, found: 49 })).toBe('Sealed batch 4 should hold 50 entries but now holds 49 — entries have been removed or added.')
    expect(describeProblem({ seal: 4, problem: 'rows_do_not_match_seal' })).toBe('The entries in sealed batch 4 no longer match their seal.')
    expect(describeProblem({ seal: 5, problem: 'chain_broken' })).toBe('The chain of seals is broken at sealed batch 5 — an earlier seal has been changed or removed.')
    expect(describeProblem({ seal: 5, problem: 'seal_altered' })).toBe('The seal on sealed batch 5 has itself been altered.')
    expect(describeProblem({ problem: 'seal_missing', rows: 12 })).toBe('12 entries point to a seal that no longer exists.')
    expect(describeProblem({ problem: 'seal_missing', rows: 1 })).toBe('1 entry points to a seal that no longer exists.')
    expect(describeProblem({ problem: 'unsealed_row_content_changed', seq: 999 })).toBe('Entry number 999 (recent, not yet sealed) has been altered since it was recorded.')
    expect(describeProblem({ problem: 'erased_without_record', rows: 1, seq: 12 })).toBe('1 entry has been blanked as if for a privacy request, but no such request was recorded (the first is entry number 12).')
    expect(describeProblem({ problem: 'something_new', seq: 4 })).toBe('Something new (entry number 4).')
    expect(describeProblem(null)).toBe('Unknown problem.')
  })

  it('names what is not covered', () => {
    expect(coverageLabel('orders')).toBe('sales')
    expect(coverageLabel('order_items:insert')).toBe('new sale lines')
    expect(coverageLabel('auditlog.log:append_only')).toBe('the lock on the log itself')
    expect(coverageLabel('auditlog.seals:append_only')).toBe('the lock on the seals')
    expect(coverageLabel('brand_new_table')).toBe('brand new table')
    expect(coverageLabel('products:truncate')).toBe('products being wiped all at once')
    expect(coverageLabel('orders:guard')).toBe('the guard on sales')
    expect(coverageLabel('members:protected_fields')).toBe('the guard on PINs, tab balances and app logins')
    expect(coverageLabel('auditlog.log:append_only_truncate')).toBe('the lock against wiping the log itself')
    expect(coverageLabel('auditlog.log:log_before_insert')).toBe('the tamper stamp on new entries in the log itself')
    expect(coverageLabel('auditlog.manifests:append_only')).toBe('the lock on the record of accepted recording code')
  })

  it('sorts a coverage report into what is not recorded and what is not protected', () => {
    expect(coverageLines({ missing: [], disabled: [], repointed: [] })).toEqual([])
    expect(coverageLines(null)).toEqual([])
    // a database from before "repointed" existed simply has nothing to say about it
    expect(coverageLines({ tables: 22, missing: ['order_items:insert'], disabled: ['orders'] })).toEqual([
      'Not being recorded: new sale lines',
      'Recording has been switched off for: sales',
    ])
    expect(coverageLines({ missing: ['orders:guard', 'zz_new_thing'], disabled: 'oops', repointed: ['stock_movements:insert'] })).toEqual([
      'Not being recorded: zz new thing',
      'Protection is missing: the guard on sales',
      'Redirected away from the log’s own code: new stock records',
    ])
  })
})

describe('describeEntry — what the till app reported (kind: event)', () => {
  const cases = [
    ['app.started', event('app.started', { build: 'abc1234', online: true, installed: true, screen: '1280x800' }), 'Till app started (version abc1234)', 'till'],
    ['app.error', event('app.error', { message: 'x is not a function', source: 'app.js', line: 10 }, { severity: 1 }), 'The till app hit an error: x is not a function', 'till'],
    ['app.davey_mode', event('app.davey_mode'), 'Davey mode opened', 'till'],
    ['connection.lost', event('connection.lost', {}, { severity: 1 }), 'Till lost its connection', 'till'],
    ['connection.restored', event('connection.restored', {}, { severity: 1 }), 'Till back online', 'till'],
    ['page.viewed', event('page.viewed', { path: '/stock' }), 'Opened the Stock page', 'till'],
    ['page.viewed (unknown page)', event('page.viewed', { path: '/somewhere' }), 'Opened the “/somewhere” page', 'till'],
    ['device.signed_in', event('device.signed_in', {}, { ...nobody, severity: 1 }), 'Till device signed in', 'signin'],
    ['device.sign_in_failed', event('device.sign_in_failed', { message: 'Invalid login credentials', email: 'till1@example.test' }, { ...nobody, severity: 2 }), 'Till device sign-in failed for till1@example.test — Invalid login credentials', 'signin'],
    ['device.signed_out', event('device.signed_out', {}, { ...nobody, severity: 2 }), 'Till device signed out', 'signin'],
    ['till.locked (idle)', event('till.locked', { reason: 'idle', minutes: 5 }), 'Till locked itself after 5 minutes of nobody using it', 'signin'],
    ['till.locked (manual)', event('till.locked', { reason: 'manual', minutes: 5 }), 'Till locked with the Lock button', 'signin'],
    ['till.unlocked', event('till.unlocked'), 'Till unlocked with a PIN', 'signin'],
    ['till.unlocked (by sign-in)', event('till.unlocked', { via: 'sign_in' }), 'Till unlocked by someone signing in', 'signin'],
    ['till.unlocked_unverified', event('till.unlocked_unverified', {}, { severity: 2 }), 'Till unlocked WITHOUT a PIN check', 'signin'],
    ['till.unlocked_unverified (server unreachable)', event('till.unlocked_unverified', { reason: 'unreachable' }, { severity: 2 }), 'Till unlocked WITHOUT a PIN check', 'signin'],
    ['till.unlocked_unverified (PIN locked out)', event('till.unlocked_unverified', { reason: 'pin_locked' }, { severity: 2 }), 'Till unlocked WITHOUT a PIN check, after five wrong PINs had locked that PIN', 'signin'],
    ['till.lock_skipped_offline', event('till.lock_skipped_offline', {}, { severity: 1 }), 'Till stayed unlocked while idle because it was offline', 'signin'],
    ['till.lock_skipped_offline (offline)', event('till.lock_skipped_offline', { reason: 'offline' }, { severity: 1 }), 'Till stayed unlocked while idle because it was offline', 'signin'],
    ['till.lock_skipped_offline (unreachable)', event('till.lock_skipped_offline', { reason: 'unreachable' }, { severity: 1 }), 'Till stayed unlocked while idle because it could not reach the server', 'signin'],
    ['pin_gate.cancelled', event('pin_gate.cancelled', { purpose: 'z_report' }), 'Backed out of the PIN check for the Z report', 'signin'],
    ['sync.replayed', event('sync.replayed', { orders: 3, stock_movements: 1 }, { severity: 1 }), 'Sent 3 saved-up sales and 1 stock record after being offline', 'till'],
    ['sync.failed', event('sync.failed', { what: 'order', message: 'boom', count: 2, order_id: ORDER1 }, { severity: 1 }), 'Could not send 2 saved-up sales: boom', 'till'],
    ['cart.line_removed', event('cart.line_removed', { product: 'Guinness', quantity: 2, unit_price: 7.4, value: 14.8 }, { severity: 1 }), 'Removed 2 × Guinness (£14.80) from an order before payment', 'sales'],
    ['cart.quantity_reduced', event('cart.quantity_reduced', { product: 'Guinness', from: 3, to: 1, value_removed: 14.8 }, { severity: 1 }), 'Cut Guinness from 3 to 1 (£14.80 less) on an order before payment', 'sales'],
    ['cart.bundle_quantity_increased', event('cart.bundle_quantity_increased', { product: 'Corona', from: 5, to: 6, unit_price: 3.2 }, { severity: 1 }), 'Raised Corona from 5 to 6 at the deal price (£3.20 each)', 'sales'],
    ['cart.order_voided', event('cart.order_voided', { lines: 2, value: 15.8, member: 'Mo Member', member_id: MO, items: [{ product: 'Guinness', quantity: 2, value: 14.8 }, { product: 'Crisps', quantity: 1, value: 1 }] }, { severity: 1 }), 'Cleared a whole order before payment: 2 lines worth £15.80', 'sales'],
    ['cart.member_attached', event('cart.member_attached', { member_id: MO, member_name: 'Mo Member', method: 'number' }), 'Put Mo Member on the order', 'sales'],
    ['cart.member_cleared', event('cart.member_cleared', { member_id: MO, member_name: 'Mo Member', lines_at_member_price: 2 }, { severity: 1 }), 'Took Mo Member off the order', 'sales'],
    ['cart.bundle_added', event('cart.bundle_added', { bundle: 'bottles_5_for_4', lines: 2, value: 16, items: [{ product: 'Corona', quantity: 3 }, { product: 'Peroni', quantity: 2 }] }), 'Added a deal to the order: 5 bottles for the price of 4 (£16.00)', 'sales'],
    ['cart.staff_credit_added', event('cart.staff_credit_added', { product: 'Guinness', for_staff_id: KIM, for_staff_name: 'Kim Newstarter', self_award: false }), 'Rang Guinness as a drink for Kim Newstarter', 'sales'],
    ['sales.recent_viewed', event('sales.recent_viewed'), 'Opened the list of today’s sales (Fix Payment)', 'sales'],
    ['pricing.members_only_mode_on', event('pricing.members_only_mode_on', {}, { severity: 1 }), 'Members-only pricing switched on', 'prices'],
    ['pricing.members_only_mode_off', event('pricing.members_only_mode_off', {}, { severity: 1 }), 'Members-only pricing switched off', 'prices'],
    ['pricing.members_only_mode_off (automatic)', event('pricing.members_only_mode_off', { reason: 'staff_signed_out' }, { severity: 1 }), 'Members-only pricing switched off (automatically, when the staff member signed out)', 'prices'],
    ['sale.completed (saved)', event('sale.completed', { order_id: ORDER1, total: 13.8, method: 'tab', lines: 2, saved: 'online', printed: true }), 'Sale of £13.80 on tab completed', 'sales'],
    ['sale.completed (kept for later)', event('sale.completed', { order_id: ORDER1, total: 13.8, method: 'cash', lines: 2, saved: 'fallback', printed: false }, { severity: 1 }), 'Sale of £13.80 by cash kept on the till to send later (no connection)', 'sales'],
    ['sale.completed (not saved)', event('sale.completed', { order_id: ORDER1, total: 13.8, method: 'card', lines: 1, saved: 'failed', printed: true, member_id: null, items: [{ product_id: GUINNESS, quantity: 2, unit_price: 6.9 }] }, { severity: 2 }), 'SALE NOT SAVED: £13.80 by card was taken but could not be stored anywhere', 'sales'],
    ['sale.cash_tendered', event('sale.cash_tendered', { total: 13.8, tendered: 20, change: 6.2 }), 'Cash sale of £13.80: £20.00 handed over, £6.20 change', 'sales'],
    ['sale.cash_tendered (tab payment)', event('sale.cash_tendered', { total: 10, tendered: 10, change: 0, tab_payment: true, member_id: MO }), 'Cash tab payment of £10.00: £10.00 handed over, £0.00 change', 'sales'],
    ['drawer.opened_no_sale', event('drawer.opened_no_sale', { source: 'settings' }, { severity: 2 }), 'Cash drawer opened without a sale (from the Settings page)', 'tabs'],
    ['drawer.open_failed', event('drawer.open_failed', { source: 'cashback', message: 'timeout' }, { severity: 1 }), 'Cash drawer did not open (cashback): timeout', 'tabs'],
    ['printer.test_printed', event('printer.test_printed', { ok: true }, { severity: 1 }), 'Test receipt printed', 'till'],
    ['printer.test_printed (failed)', event('printer.test_printed', { ok: false }, { severity: 1 }), 'Test receipt failed to print', 'till'],
    ['receipt.print_failed', event('receipt.print_failed', { what: 'tab_statement', message: 'timeout', member_id: MO }, { severity: 1 }), 'Tab statement failed to print: timeout', 'till'],
    ['settings.printer_ip_changed', event('settings.printer_ip_changed', { from: '192.168.0.250', to: '192.168.0.249' }, { severity: 2 }), 'Printer address changed from 192.168.0.250 to 192.168.0.249', 'till'],
    ['settings.idle_lock_changed', event('settings.idle_lock_changed', { from: 5, to: 10 }, { severity: 2 }), 'Automatic lock time changed from 5 minutes to 10 minutes', 'till'],
    ['settings.idle_lock_changed (off)', event('settings.idle_lock_changed', { from: 5, to: 0 }, { severity: 2 }), 'Automatic locking switched off (was 5 minutes)', 'till'],
    ['report.viewed', event('report.viewed', { report: 'daily', date: '2026-11-21' }), 'Looked at the daily report for Sat 21 Nov', 'till'],
    ['report.viewed (price changes)', event('report.viewed', { report: 'price_changes' }), 'Looked at the price changes list', 'till'],
    ['report.exported', event('report.exported', { report: 'stocktake', from: '2026-11-01', to: '2026-11-21', rows: 40 }, { severity: 1 }), 'Exported the stocktake for Sun 1 Nov to Sat 21 Nov (40 lines)', 'till'],
    ['report.emailed', event('report.emailed', { report: 'z_report', date: '2026-11-21', seal: 'S42-4F2A-91BC' }, { severity: 1 }), 'Emailed the Z report for Sat 21 Nov', 'till'],
    ['report.email_failed', event('report.email_failed', { report: 'monthly', month: '2026-10', message: 'no recipients' }, { severity: 1 }), 'Could not email the monthly report for 2026-10: no recipients', 'till'],
    ['day.closed', event('day.closed', { date: '2026-11-21', opening_float: 300, actual_cash: 512.4, expected_cash: 510, variance: 2.4, tills: { 'till-1': { opening_float: 150, expected_cash: 255, actual_cash: 256.2, variance: 1.2 }, 'till-2': { opening_float: 150, expected_cash: 255, actual_cash: 253, variance: -2 } } }, { severity: 1 }), 'Closed the day for Sat 21 Nov: cash counted £512.40, expected £510.00 — £2.40 over', 'tabs'],
    ['tab.statement_printed', event('tab.statement_printed', { member_id: MO, member_name: 'Mo Member' }), 'Printed a tab statement for Mo Member', 'tabs'],
    ['tab.summary_printed', event('tab.summary_printed', { tabs: 12, total: 340 }), 'Printed the tabs summary (12 tabs, £340.00)', 'tabs'],
    ['tab.amount_revealed', event('tab.amount_revealed', { member_id: MO }), 'Revealed Mo Member’s tab amount', 'tabs'],
    ['tab.amount_revealed (total)', event('tab.amount_revealed', { member_id: null, what: 'total_outstanding' }), 'Revealed the total owed on all tabs', 'tabs'],
    ['tab.order_removed', event('tab.order_removed', { order_id: ORDER1, member_id: MO, member_name: 'Mo Member', value: 13.8 }, { severity: 1 }), 'Removed a £13.80 sale from Mo Member’s tab', 'tabs'],
    ['tab.orders_viewed', event('tab.orders_viewed', { member_id: MO, member_name: 'Mo Member' }), 'Looked at the sales on Mo Member’s tab', 'tabs'],
    ['member.profile_viewed', event('member.profile_viewed', { member_id: MO }), 'Opened Mo Member’s profile', 'till'],
    ['guests.viewed', event('guests.viewed', { date: '2026-11-21', guests: 4 }), 'Looked at the guest list for Sat 21 Nov (4 guests)', 'till'],
    ['integrity.seal_mismatch_seen', event('integrity.seal_mismatch_seen', { remembered: 'S42-4F2A-91BC' }, { severity: 2 }), 'This till noticed its remembered seal (S42-4F2A-91BC) is no longer in the database', 'system'],
    ['integrity.seal_mismatch_seen (number only)', event('integrity.seal_mismatch_seen', { remembered: null, remembered_seal: 42 }, { severity: 2 }), 'This till noticed its remembered seal (seal number 42) is no longer in the database', 'system'],
    ['an event it has never heard of', event('cart.coupon_applied', { code: 'X' }), 'Till reported: cart coupon applied', 'sales'],
  ]

  it.each(cases)('%s', (_name, entry, expected, category) => {
    const d = describeEntry(entry, { names })
    expect(d.title).toBe(expected)
    expect(d.category).toBe(category)
    expectPlain(d)
    // ...and still plain when no names are to hand
    expectPlain(describeEntry(entry, {}))
  })

  it('adds the detail that matters under the sentence', () => {
    expect(lines(event('cart.order_voided', {
      lines: 2, value: 15.8, member: 'Mo Member', member_id: MO,
      items: [{ product: 'Guinness', quantity: 2, value: 14.8 }, { product: 'Crisps', quantity: 1, value: 1 }],
    }))).toEqual(['2 × Guinness (£14.80), 1 × Crisps (£1.00)', 'Member on the order: Mo Member'])
    expect(lines(event('cart.line_removed', { product: 'Guinness', quantity: 1, value: 7.4, for_staff: 'Kim Newstarter', bundle: true })))
      .toEqual(['It was a drink for Kim Newstarter', 'It was part of a deal'])
    expect(lines(event('cart.member_cleared', { member_id: MO, member_name: 'Mo Member', lines_at_member_price: 2 })))
      .toEqual(['2 lines already on the order kept the members’ price'])
    expect(lines(event('cart.member_cleared', { member_id: MO, member_name: 'Mo Member', lines_at_member_price: 0 }))).toEqual([])
    expect(lines(event('cart.staff_credit_added', { product: 'Guinness', for_staff_id: SAM, for_staff_name: 'Sam Staff', self_award: true }, { severity: 1 })))
      .toEqual(['They rang it for themselves'])
    expect(lines(event('cart.bundle_added', { bundle: 'shots_4_for_10', value: 10, items: [{ product: 'Sambuca', quantity: 4 }] })))
      .toEqual(['4 × Sambuca'])
    expect(lines(event('sale.completed', { total: 13.8, method: 'card', lines: 1, saved: 'failed', printed: false, items: [{ product_id: GUINNESS, quantity: 2, unit_price: 6.9 }] })))
      .toEqual(['1 line', 'No receipt was printed', '2 × Guinness at £6.90'])
    expect(lines(event('report.emailed', { report: 'z_report', date: '2026-11-21', seal: 'S42-4F2A-91BC' })))
      .toEqual(['Seal S42-4F2A-91BC was included in the email'])
    expect(lines(event('settings.printer_ip_changed', { from: '192.168.0.250', to: '' })))
      .toEqual(['With no printer address, receipts do not print and the cash drawer does not open'])
  })

  it('shows each till’s figures when the day is closed, over or short', () => {
    const entry = event('day.closed', {
      date: '2026-11-21', opening_float: 300, actual_cash: 510, expected_cash: 510, variance: 0,
      tills: {
        'till-1': { opening_float: 150, expected_cash: 255, actual_cash: 257, variance: 2 },
        'till-2': { opening_float: 150, expected_cash: 255, actual_cash: 253, variance: -2 },
      },
    })
    const d = describeEntry(entry, { names })
    expect(d.title).toBe('Closed the day for Sat 21 Nov: cash counted £510.00, expected £510.00 — exactly right')
    expect(d.lines).toEqual([
      'Till 1: float £150.00, expected £255.00, counted £257.00 — £2.00 over',
      'Till 2: float £150.00, expected £255.00, counted £253.00 — £2.00 short',
    ])
  })

  it('says why a till was unlocked without a PIN, and what that means for what followed', () => {
    const said = 'What they did next is recorded as “said to be” them, not “PIN checked”'
    expect(lines(event('till.unlocked_unverified', { reason: 'unreachable' }))).toEqual([
      'The PIN could not be checked (the server could not be reached), and someone chose to carry on', said,
    ])
    expect(lines(event('till.unlocked_unverified', { reason: 'pin_locked' }))).toEqual([
      'Someone chose “carry on without checking the PIN” while the PIN was locked out', said,
    ])
    // an older till app gave no reason
    expect(lines(event('till.unlocked_unverified'))).toEqual([
      'The PIN could not be checked (usually no connection), and someone chose to carry on', said,
    ])
  })

  it('says the till keeps its own copy of a seal the database lost', () => {
    expect(lines(event('integrity.seal_mismatch_seen', { remembered: 'S42-4F2A-91BC', remembered_seal: 42 }))).toEqual([
      'History may have been rewritten, or the database was restored from a backup.',
      'The till has kept its own copy of that seal as evidence; it is listed at the top of the Log on that till.',
    ])
  })

  it('falls back to plain words when a member’s name is not known', () => {
    expect(title(event('tab.amount_revealed', { member_id: MO }), {})).toBe('Revealed a hidden tab amount')
    expect(title(event('member.profile_viewed', { member_id: MO }), {})).toBe('Opened a member’s profile')
    expect(title(event('cart.member_attached', { member_id: MO }), {})).toBe('Put a member on the order')
  })

  it('says when the till’s detail was too big to keep, or earlier reports were lost', () => {
    expect(lines(event('app.started', { truncated: true, bytes: 7000 }))).toEqual(['The till sent more detail than the log keeps, so it was left out'])
    expect(lines(event('page.viewed', { path: '/', events_dropped_before_this: 3 }))).toEqual(['3 earlier till reports were lost before this one'])
  })
})

describe('describeEntry — anything else', () => {
  it('never throws, whatever it is given', () => {
    for (const odd of [null, undefined, {}, 'text', 42, [], { kind: 'row' }, { kind: 'row', table: 'orders', action: 'insert', new: 'oops' },
      { kind: 'event', action: null, detail: 'oops' }, { kind: 'guard', action: 'blocked.update', table: 'orders', old: null, new: null },
      { kind: 'auth' }, { kind: 'system', action: 'integrity.FAILED', detail: { problems: 'oops' } }]) {
      const d = describeEntry(odd)
      expect(typeof d.title).toBe('string')
      expect(d.title.length).toBeGreaterThan(0)
      expect(Array.isArray(d.lines)).toBe(true)
      expect(Array.isArray(d.tags)).toBe(true)
      expect(typeof d.category).toBe('string')
    }
  })

  it('gives a readable sentence for a kind it has never heard of', () => {
    expect(describeEntry({ kind: 'mystery', action: 'who.knows' })).toEqual({ title: 'Who knows', lines: [], tags: [], category: 'other' })
    expect(describeEntry({}).title).toBe('Something happened')
  })

  it('words a flag it has never heard of rather than hiding it', () => {
    const entry = row('products', 'update', {
      pk: GUINNESS, subject: 'Guinness', changed: ['active'], old: { active: true }, new: { active: false }, detail: { flags: ['brand_new_reason'] },
    })
    expect(tags(entry)).toEqual(['Brand new reason'])
  })
})

describe('the sentences as a whole', () => {
  const everything = () => [
    row('products', 'update', { pk: GUINNESS, subject: null, changed: ['supplier_id'], old: { supplier_id: SAM }, new: { supplier_id: KIM } }),
    row('orders', 'insert', { pk: ORDER1, new: { id: ORDER1, member_id: MO, staff_id: KIM, payment_method: 'tab', total_amount: 5 }, detail: { rung_by_trust: 'claimed' } }),
    row('orders', 'update', { pk: ORDER1, changed: ['member_id', 'staff_id'], old: { member_id: MO, staff_id: SAM }, new: { member_id: KIM, staff_id: KIM } }),
    saleLinesEntry(),
    row('order_items', 'delete', { old: { id: LINE1, order_id: ORDER1, product_id: GUINNESS, quantity: 1, unit_price: 2 } }),
    row('stock_movements', 'insert', { new: [{ id: LINE1, product_id: GUINNESS, type: 'wastage', quantity: 1, member_id: MO }] }),
    row('members', 'update', { pk: MO, subject: null, changed: ['auth_user_id'], old: { auth_user_id: SAM }, new: { auth_user_id: KIM } }),
    row('promotion_items', 'insert', { new: { id: LINE1, promotion_id: PROMO, product_id: GUINNESS, discount_type: 'percentage', discount_value: 10 } }),
    row('tab_adjustments', 'insert', { new: { id: LINE1, member_id: MO, amount: 1, reason: 'r', staff_id: SAM } }),
    row('staff_drink_credits', 'insert', { new: { id: LINE1, staff_member_id: SAM, product_id: GUINNESS, amount: 1, order_id: ORDER1 } }),
    row('guest_signins', 'insert', { new: { id: LINE1, guest_name: 'G', member_id: MO, staff_id: SAM } }),
    row('pin_attempts', 'insert', { pk: KIM, new: { member_id: KIM, failed_count: 2 } }),
    row('till_devices', 'update', { pk: SAM, changed: ['auth_user_id'], old: { auth_user_id: SAM }, new: { auth_user_id: KIM } }),
    row('purchase_orders', 'update', { pk: SAM, changed: ['supplier_id'], old: { supplier_id: SAM }, new: { supplier_id: KIM } }),
    auth('pin.wrong_pin', SAM, null, { attempts_remaining: 2 }),
    guard('blocked.update', 'orders', { pk: ORDER1, old: { id: ORDER1, member_id: MO, total_amount: 1 }, new: { id: ORDER1, member_id: KIM, total_amount: 2 } }),
    guard('blocked.delete', 'order_items', { pk: LINE1, old: { id: LINE1, order_id: ORDER1, product_id: GUINNESS, quantity: 1, unit_price: 2 } }),
    system('alert.checked', { note: 'n' }, { pk: '12' }),
    system('integrity.witness_mismatch', { seal: 5, remembered_hash: 'abc' }),
    system('coverage.gap', { missing: ['orders:guard'], disabled: ['auditlog.log:log_before_insert'], repointed: ['members:protected_fields', 'products:truncate'] }),
    system('coverage.changed', { note: 'n' }),
    system('manifest.accepted', { digest: 'abc', reason: 'r' }),
    system('integrity.checked', { ok: true, scope: 'recent', since: '2026-10-22T12:00:00.000Z', seals_rehashed: 3, rows_checked: 9, problems: [] }),
    row('orders', 'insert', { pk: ORDER2, staff_id: KIM, staff_name: 'Kim Newstarter', staff_trust: 'claimed', new: { id: ORDER2, staff_id: KIM, total_amount: 1 }, detail: { sent_by: SAM, sent_by_trust: 'pin', rung_by_trust: 'claimed', flags: ['staff_mismatch'] } }),
    row('orders', 'insert', { ...nobody, pk: ORDER3, new: { id: ORDER3, total_amount: 1 }, detail: { sent_by: SAM, sent_by_trust: 'pin', late_by_seconds: 900, flags: ['arrived_late', 'no_staff_on_sale'] } }),
    guard('blocked.update', 'members', { pk: KIM, subject: null, changed: ['auth_user_id', 'pin_hash'], old: { auth_user_id: SAM, pin_hash: '[redacted]' }, new: { auth_user_id: MO, pin_hash: '[redacted]' }, detail: { rule: 'protected_fields', flags: ['direct_edit_of_protected_field'] } }),
    guard('would_block.update', 'members', { pk: KIM, subject: null, via: 'POST /rpc/graphql', changed: ['auth_user_id'], old: { auth_user_id: SAM }, new: { auth_user_id: MO }, detail: { rule: 'protected_fields', flags: ['direct_edit_of_protected_field'] } }),
    event('till.unlocked_unverified', { reason: 'pin_locked' }),
    event('integrity.seal_mismatch_seen', { remembered: 'S42-4F2A-91BC', remembered_seal: 42 }),
    event('tab.order_removed', { order_id: ORDER1, member_id: MO, value: 1 }),
    event('sale.completed', { order_id: ORDER1, total: 1, method: 'cash', saved: 'failed', member_id: MO, items: [{ product_id: GUINNESS, quantity: 1, unit_price: 1 }] }),
    event('sync.failed', { what: 'order', count: 1, order_id: ORDER1, message: 'm' }),
  ]

  it('never puts a raw id in a sentence, with or without names to hand', () => {
    const uuid = UUID_TEXT
    for (const ctx of [{ names }, {}]) {
      for (const entry of everything()) {
        const d = describeEntry(entry, ctx)
        expect(d.title, `${entry.kind} ${entry.action} ${entry.table ?? ''}`).not.toMatch(uuid)
        for (const line of d.lines) expect(line, `${entry.kind} ${entry.action} ${entry.table ?? ''}`).not.toMatch(uuid)
      }
    }
  })

  it('never uses database jargon', () => {
    const jargon = JARGON
    for (const entry of everything()) {
      const d = describeEntry(entry, {})
      for (const text of [d.title, ...d.lines, ...d.tags]) expect(text).not.toMatch(jargon)
    }
  })
})

describe('combineSaleEntries and salesIndex', () => {
  it('folds a sale’s lines into the sale wherever both are in the list', () => {
    const lineEntry = saleLinesEntry()
    const sale = saleEntry()
    const other = row('products', 'insert', { pk: GUINNESS, new: { name: 'Guinness', standard_price: 1, member_price: 1 } })
    const combined = combineSaleEntries([lineEntry, sale, other])
    expect(combined).toHaveLength(2)
    expect(combined[0].seq).toBe(sale.seq)
    expect(combined[0].sale_lines).toBe(lineEntry)
    expect(combined[1]).toBe(other)
  })

  it('leaves lines alone when their sale is not in the list (and the other way round)', () => {
    const lineEntry = saleLinesEntry()
    expect(combineSaleEntries([lineEntry])).toEqual([lineEntry])
    const sale = saleEntry()
    expect(combineSaleEntries([sale])).toEqual([sale])
    expect(combineSaleEntries(null)).toEqual([])
  })

  it('does not fold lines that belong to no single sale, or a different one', () => {
    const orphan = { ...saleLinesEntry(), pk: null }
    const elsewhere = { ...saleLinesEntry(), pk: ORDER2 }
    const sale = saleEntry()
    expect(combineSaleEntries([orphan, elsewhere, sale])).toHaveLength(3)
  })

  it('carries the severity, flags and unchecked state of both halves', () => {
    const lineEntry = { ...saleLinesEntry(), severity: 2, checked: false }
    const sale = { ...saleEntry(), severity: 2, checked: true, detail: { rung_by_trust: 'claimed', flags: ['staff_unverified'] } }
    const [combined] = combineSaleEntries([lineEntry, sale])
    expect(entrySeverity(combined)).toBe(2)
    expect(entryFlags(combined)).toEqual(['staff_unverified', 'below_list_price'])
    expect(uncheckedSeqs(combined)).toEqual([lineEntry.seq])
  })

  it('indexes the sales on the page by their id', () => {
    const sale = saleEntry()
    expect(salesIndex([sale, saleLinesEntry()])).toEqual({ [ORDER1]: sale.new })
    expect(salesIndex(undefined)).toEqual({})
  })
})

describe('entrySeverity and uncheckedSeqs', () => {
  it('clamps severity and only asks for alerts to be checked', () => {
    expect(entrySeverity({ severity: 7 })).toBe(3)
    expect(entrySeverity({})).toBe(0)
    expect(uncheckedSeqs({ seq: 5, severity: 2, checked: false })).toEqual([5])
    expect(uncheckedSeqs({ seq: 5, severity: 2, checked: true })).toEqual([])
    expect(uncheckedSeqs({ seq: 5, severity: 1, checked: false })).toEqual([])
  })

  it('shows carrying on past a locked-out PIN as serious, whatever the till was allowed to call it', () => {
    expect(entrySeverity(event('till.unlocked_unverified', { reason: 'pin_locked' }, { severity: 2 }))).toBe(3)
    expect(entrySeverity(event('till.unlocked_unverified', { reason: 'unreachable' }, { severity: 2 }))).toBe(2)
    expect(entrySeverity(event('till.unlocked_unverified', {}, { severity: 2 }))).toBe(2)
  })
})

describe('describeCheck', () => {
  const alert = (extra = {}) => ({ ...base(), kind: 'event', action: 'drawer.opened_no_sale', severity: 2, ...extra })

  it('is null until the alert has been checked', () => {
    expect(describeCheck(alert())).toBeNull()
    expect(describeCheck(null)).toBeNull()
  })

  it('says who checked it, when, and what they wrote', () => {
    const entry = alert({ checked: true, checked_at: '2026-11-21T15:00:00.000Z', checked_by: 'Kim Newstarter', checked_by_self: false, check_note: ' looked into it ' })
    expect(describeCheck(entry)).toEqual({ by: 'Kim Newstarter', at: '2026-11-21T15:00:00.000Z', note: 'looked into it', bySelf: false })
  })

  it('says when the person who checked it is the person it is about', () => {
    const entry = alert({ checked: true, checked_at: '2026-11-21T15:00:00.000Z', checked_by: 'Sam Staff', checked_by_self: true, check_note: null })
    expect(describeCheck(entry)).toMatchObject({ by: 'Sam Staff', bySelf: true, note: null })
  })

  it('copes with a database that only says THAT it was checked', () => {
    expect(describeCheck(alert({ checked: true }))).toEqual({ by: null, at: null, note: null, bySelf: false })
    expect(describeCheck(alert({ checked: true, checked_at: 'not a date', checked_by: null }))).toEqual({ by: null, at: null, note: null, bySelf: false })
  })

  it('reads the check from either half of a sale shown as one entry', () => {
    const sale = { ...saleEntry(), severity: 2, checked: true, checked_at: null, checked_by: null }
    const saleLines = { ...saleLinesEntry(), severity: 3, checked: true, checked_at: '2026-11-21T15:00:00.000Z', checked_by: 'Sam Staff', checked_by_self: true, check_note: 'mine' }
    expect(describeCheck({ ...sale, sale_lines: saleLines })).toEqual({ by: 'Sam Staff', at: '2026-11-21T15:00:00.000Z', note: 'mine', bySelf: true })
  })
})

describe('describeWho', () => {
  it('names the staff member with an honest confidence tag', () => {
    expect(describeWho({ staff_id: SAM, staff_name: 'Sam Staff', staff_trust: 'pin', actor: 'till' })).toEqual({ name: 'Sam Staff', tag: 'PIN checked', trust: 'pin' })
    expect(describeWho({ staff_id: SAM, staff_name: 'Sam Staff', staff_trust: 'session_record', actor: 'till' }).tag).toBe('matched a sign-in')
    expect(describeWho({ staff_id: SAM, staff_name: 'Sam Staff', staff_trust: 'claimed', actor: 'till' }).tag).toBe('said to be')
  })

  it('says nobody was signed in rather than guessing', () => {
    expect(describeWho({ staff_id: null, staff_name: null, staff_trust: 'none', actor: 'till' })).toEqual({ name: null, tag: 'nobody signed in', trust: 'none' })
  })

  it('copes with a staff member who is no longer on the list', () => {
    expect(describeWho({ staff_id: SAM, staff_name: null, staff_trust: 'pin', actor: 'till' }).name).toBe('A staff member no longer on the list')
  })

  it('says when it was not a till at all', () => {
    expect(describeWho({ actor: 'database', via: 'sql:postgres/psql', staff_trust: 'none' }).name).toBe('Someone working directly in the database')
    expect(describeWho({ actor: 'database', via: 'cron:audit-nightly', staff_trust: 'none' }).name).toBe('Automatic job')
    expect(describeWho({ actor: 'database', via: 'migration:20261123120000_audit_log', staff_trust: 'none' }).name).toBe('Database update')
    expect(describeWho({ actor: 'service', via: 'fn:verify-pin POST /pin_attempts', staff_trust: 'none' }).name).toBe('The system')
    expect(describeWho({ actor: 'member', staff_trust: 'none' }).name).toBe('A member’s own login')
    expect(describeWho({ actor: 'anon', staff_trust: 'none' }).name).toBe('Someone not signed in to anything')
  })
})

describe('describeVia', () => {
  it('says how an entry reached the database without jargon', () => {
    expect(describeVia('POST /rpc/create_order_with_items')).toBe('Through the app’s routine “create_order_with_items”')
    expect(describeVia('PATCH /products')).toBe('Straight to the products list (editing)')
    expect(describeVia('DELETE /orders')).toBe('Straight to the sales list (deleting from)')
    expect(describeVia('sql:postgres/psql')).toBe('Typed straight into the database (as postgres, using psql)')
    expect(describeVia('cron:audit-nightly')).toBe('Automatic job (audit-nightly)')
    expect(describeVia('migration:20261123120000_audit_log')).toBe('Database update (20261123120000_audit_log)')
    expect(describeVia('fn:verify-pin POST /pin_attempts')).toBe('Server function “verify-pin” — straight to the wrong-PIN counts list (adding to)')
    expect(describeVia(null)).toBe('Not recorded')
    expect(describeVia('POST /rpc/graphql')).toBe('Through the database’s GraphQL door, not the till app')
    expect(describeVia('fn:some-function POST /rpc/graphql')).toBe('Server function “some-function” — through the database’s GraphQL door, not the till app')
    expect(describeVia('POST /rpc/graphql_report')).toBe('Through the app’s routine “graphql_report”')
    expect(viaGraphql('POST /rpc/graphql')).toBe(true)
    expect(viaGraphql('POST /rpc/create_order_with_items')).toBe(false)
    expect(viaGraphql(null)).toBe(false)
    for (const via of ['POST /rpc/x', 'PATCH /products', 'sql:postgres', 'fn:verify-pin POST /rpc/y']) {
      expect(describeVia(via)).not.toMatch(/\brpc\b/i)
    }
  })
})

describe('happenedAt', () => {
  it('is null when the till’s clock and the log agree to within two minutes', () => {
    expect(happenedAt({ at: '2026-11-21T14:02:00.000Z', client_at: '2026-11-21T14:01:10.000Z' })).toBeNull()
    expect(happenedAt({ at: '2026-11-21T14:02:00.000Z', client_at: null })).toBeNull()
    expect(happenedAt({})).toBeNull()
  })

  it('gives the till’s own time when a report arrived late', () => {
    expect(happenedAt({ at: '2026-11-21T17:31:00.000Z', client_at: '2026-11-21T14:02:00.000Z' })).toBe('2026-11-21T14:02:00.000Z')
  })

  it('uses the sale’s own time for an offline sale sent in later', () => {
    const entry = row('orders', 'insert', { at: '2026-11-21T14:02:00.000Z', new: { created_at: '2026-11-21T11:02:00.000Z', total_amount: 1 } })
    expect(happenedAt(entry)).toBe('2026-11-21T11:02:00.000Z')
    const edit = row('orders', 'update', { at: '2026-11-21T14:02:00.000Z', changed: ['created_at'], new: { created_at: '2026-11-21T11:02:00.000Z' } })
    expect(happenedAt(edit)).toBeNull()
  })
})
