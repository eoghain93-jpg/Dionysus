// describeEntry — turns one audit-log entry into plain English.
//
//   describeEntry(entry, { names, sales }) -> { title, lines, tags, category }
//
//   title     one sentence a pub owner can read: "Changed Guinness standard
//             price from £7.40 to £6.40". Never a raw id.
//   lines     extra sentences worth showing under the title (may be empty)
//   tags      the reasons the entry is notable, in words
//   category  prices | sales | tabs | stock | people | signin | till |
//             system | blocked | other
//
// Entries come from the audit_view database function (see section 10 of
// supabase/migrations/20261123120000_audit_log.sql for their exact shape).
// The optional second argument only makes sentences nicer:
//   names  { [id]: name } for products, members and promotions
//   sales  { [order id]: the sale as first recorded } (see salesIndex)
//
// Pure: no network, no clock, no store. It never throws — an entry it does
// not recognise still gets a readable sentence — and it never shows a PIN,
// a PIN fingerprint or a session token (the database redacts them before
// they are stored; this file does not print the redacted value either).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO_TIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/
const CODE_WORD = /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const asObj = v => (isObj(v) ? v : {})
const asList = v => (Array.isArray(v) ? v : v === null || v === undefined ? [] : [v])
const has = (o, k) => Object.prototype.hasOwnProperty.call(asObj(o), k)

// ── Formatting ───────────────────────────────────────────────────────────

/** £0.00, with the sign in front: -£1.50. */
export function money(value) {
  if (value === null || value === undefined || value === '') return '£?'
  const n = Number(value)
  if (!Number.isFinite(n)) return '£?'
  const pence = Math.round(n * 100)
  const text = `£${(Math.abs(pence) / 100).toFixed(2)}`
  return pence < 0 ? `-${text}` : text
}

function num(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '?'
  return String(Math.round(n * 100) / 100)
}

function count(n, one, many = `${one}s`) {
  return `${num(n)} ${Number(n) === 1 ? one : many}`
}

const quote = text => `“${text}”`
const possessive = name => (/s$/i.test(name) ? `${name}’` : `${name}’s`)
const upperFirst = text => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text)

function validDate(value) {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** 14:02 */
export function formatTime(value) {
  const d = validDate(value)
  return d ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—'
}

/** Sat 21 Nov */
export function formatDay(value) {
  const d = validDate(value)
  return d ? d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : '—'
}

/** Sat 21 Nov, 14:02 */
export function formatDateTime(value) {
  const d = validDate(value)
  return d ? `${formatDay(d)}, ${formatTime(d)}` : '—'
}

function dateOnly(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDay(`${value}T12:00:00`)
  return value ? String(value) : 'an unknown day'
}

/** "3 hours", "14 minutes" — for "arrived 3 hours late". */
export function duration(seconds) {
  const s = Math.abs(Number(seconds))
  if (!Number.isFinite(s)) return 'some time'
  if (s < 90) return count(Math.round(s), 'second')
  if (s < 90 * 60) return count(Math.round(s / 60), 'minute')
  if (s < 36 * 3600) return count(Math.round(s / 3600), 'hour')
  return count(Math.round(s / 86400), 'day')
}

/** 4.2 MB */
export function formatBytes(bytes) {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n < 1024) return `${n} bytes`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/** till-1 -> Till 1 */
export function tillLabel(tillId) {
  if (!tillId) return null
  const m = /^till-(\d+)$/.exec(String(tillId))
  return m ? `Till ${m[1]}` : String(tillId)
}

// ── Words for things ─────────────────────────────────────────────────────

const TABLE_NOUN = {
  products: ['product', 'products'],
  orders: ['sale', 'sales'],
  order_items: ['sale line', 'sale lines'],
  stock_movements: ['stock record', 'stock records'],
  members: ['member', 'members'],
  promotions: ['promotion', 'promotions'],
  promotion_items: ['promotion deal', 'promotion deals'],
  promotion_categories: ['promotion deal', 'promotion deals'],
  tab_adjustments: ['tab adjustment', 'tab adjustments'],
  order_corrections: ['payment correction', 'payment corrections'],
  cashback_transactions: ['cashback record', 'cashback records'],
  prize_wins: ['prize payout', 'prize payouts'],
  guest_signins: ['guest sign-in', 'guest sign-ins'],
  z_reports: ['day close', 'day closes'],
  staff_drink_credits: ['staff drink', 'staff drinks'],
  product_price_changes: ['price change record', 'price change records'],
  pin_attempts: ['wrong-PIN count', 'wrong-PIN counts'],
  till_devices: ['till registration', 'till registrations'],
  z_report_recipients: ['day-close email address', 'day-close email addresses'],
  monthly_report_recipients: ['monthly report email address', 'monthly report email addresses'],
  suppliers: ['supplier', 'suppliers'],
  tab_payments: ['online tab payment', 'online tab payments'],
}

const TABLE_CATEGORY = {
  products: 'prices', product_price_changes: 'prices', promotions: 'prices',
  promotion_items: 'prices', promotion_categories: 'prices', suppliers: 'prices',
  orders: 'sales', order_items: 'sales', order_corrections: 'sales', staff_drink_credits: 'sales',
  stock_movements: 'stock',
  members: 'people', guest_signins: 'people',
  tab_adjustments: 'tabs', tab_payments: 'tabs', cashback_transactions: 'tabs', prize_wins: 'tabs', z_reports: 'tabs',
  pin_attempts: 'signin',
  till_devices: 'system', z_report_recipients: 'system', monthly_report_recipients: 'system',
}

function prettify(text) {
  return String(text ?? '')
    .replace(/[_.]+/g, ' ')
    .replace(/\brows\b/gi, 'entries')
    .replace(/\brow\b/gi, 'entry')
    .replace(/\bhash\b/gi, 'code')
    .replace(/\brpc\b/gi, 'routine')
    .replace(/\btrigger\b/gi, 'protection')
    .trim()
}

/** products -> "product" (or "products" with plural = true). */
export function tableNoun(table, plural = false) {
  const known = TABLE_NOUN[table]
  if (known) return known[plural ? 1 : 0]
  const text = prettify(table) || 'record'
  return plural ? text : text.replace(/s$/, '')
}

const FIELD_LABELS = {
  standard_price: 'standard price',
  member_price: 'members’ price',
  cost_price: 'cost price',
  stock_quantity: 'stock count',
  par_level: 'par level',
  sku: 'stock code',
  supplier_id: 'supplier',
  active: 'active',
  tab_balance: 'tab balance',
  pin_hash: 'PIN',
  membership_tier: 'membership type',
  membership_number: 'membership number',
  phone: 'phone number',
  renewal_date: 'renewal date',
  favourite_drinks: 'favourite drinks',
  auth_user_id: 'app login',
  last_settled_at: 'last tab payment',
  prev_last_settled_at: 'tab payment before that',
  payment_method: 'payment type',
  total_amount: 'total',
  member_id: 'member',
  staff_id: 'staff member',
  staff_member_id: 'staff member',
  till_id: 'till',
  created_at: 'date and time',
  updated_at: 'last updated',
  changed_at: 'changed at',
  is_tab_settlement: 'is a tab payment',
  unit_price: 'price each',
  member_price_applied: 'members’ price used',
  staff_credit_for: 'bought for staff member',
  product_id: 'product',
  order_id: 'sale',
  promotion_id: 'promotion',
  guest_name: 'guest',
  report_date: 'day',
  opening_float: 'opening float',
  actual_cash: 'cash counted',
  expected_cash: 'cash expected',
  closed_at: 'closed at',
  closed_by: 'closed by',
  redeemed_at: 'poured at',
  redeemed_product_id: 'drink poured',
  redeemed_by: 'poured by',
  old_method: 'old payment type',
  new_method: 'new payment type',
  failed_count: 'wrong tries',
  locked_until: 'locked until',
  discount_type: 'deal type',
  discount_value: 'deal value',
  days_of_week: 'days of the week',
  stripe_payment_intent_id: 'card payment reference',
  old_standard_price: 'old standard price',
  new_standard_price: 'new standard price',
  old_member_price: 'old members’ price',
  new_member_price: 'new members’ price',
  list_standard: 'list price',
  list_member: 'members’ list price',
  below_list_price: 'below list price',
  rung_by_trust: 'who rang it',
  late_by_seconds: 'arrived late by',
  attempts_remaining: 'tries left',
  for_signed_in_person: 'for the person signed in',
  set_by_self: 'set by that person',
  capture_enabled: 'recording',
  guards_enforced: 'protection of past records',
  session_max_hours: 'longest sign-in (hours)',
  rows: 'entries',
  rows_checked: 'entries checked',
  seals_checked: 'seals checked',
  unsealed_rows: 'entries waiting for a seal',
  rows_at_install: 'counts when recording began',
  remembered_hash: 'remembered seal',
  ip: 'network address',
  user_agent: 'browser',
  app_build: 'app version',
  build: 'app version',
  events_dropped_before_this: 'till reports lost before this one',
  value_removed: 'value removed',
  member_name: 'member',
  order: 'sale',
}

/** A column or detail key as words: standard_price -> "standard price". */
export function fieldLabel(key) {
  return FIELD_LABELS[key] ?? prettify(key)
}

const MONEY_FIELDS = new Set([
  'standard_price', 'member_price', 'cost_price', 'tab_balance', 'total_amount', 'unit_price', 'amount',
  'opening_float', 'actual_cash', 'expected_cash', 'variance', 'list_standard', 'list_member',
  'old_standard_price', 'new_standard_price', 'old_member_price', 'new_member_price',
  'value', 'total', 'tendered', 'change', 'value_removed',
])

const PAYMENT_WORDS = { cash: 'by cash', card: 'by card', tab: 'on tab' }
const PAYMENT_NAMES = { cash: 'cash', card: 'card', tab: 'tab' }

const TIER_WORDS = { staff: 'staff', member: 'member' }

function nameOf(ctx, id) {
  if (!id) return null
  const names = asObj(ctx).names
  if (!names) return null
  const found = typeof names.get === 'function' ? names.get(id) : names[id]
  return found ? String(found) : null
}

/**
 * One stored value as text for the "full detail" panel. Ids become names
 * where the name is known. A PIN fingerprint is never shown.
 */
export function formatValue(key, value, ctx) {
  if (key === 'pin_hash') return value === null || value === undefined ? 'no PIN' : 'PIN set (hidden)'
  if (value === null || value === undefined || value === '') return '—'
  if (key === 'late_by_seconds') return duration(value)
  if (key === 'problems' && Array.isArray(value)) return value.map(describeProblem).join(' ') || 'none'
  if (key === 'capture_enabled' || key === 'guards_enforced') return value ? 'on' : 'OFF'
  if (MONEY_FIELDS.has(key) && Number.isFinite(Number(value))) return money(value)
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (typeof value === 'number') return num(value)
  if (typeof value === 'string') {
    if (key === 'till_id' || key === 'till') return tillLabel(value)
    if (key === 'payment_method' || key === 'old_method' || key === 'new_method' || key === 'method') return PAYMENT_NAMES[value] ?? value
    if (key === 'rung_by_trust' || key === 'trust' || key === 'staff_trust') return TRUST_LABELS[value] ?? prettify(value)
    if (UUID.test(value)) return nameOf(ctx, value) ?? value
    if (ISO_TIME.test(value)) return formatDateTime(value)
    // A code word such as "idle_lock" or "no_delete" reads better spaced out.
    if (CODE_WORD.test(value)) return prettify(value)
    return value
  }
  if (Array.isArray(value)) {
    if (value.every(v => v === null || typeof v !== 'object')) {
      return value.map(v => (key === 'flags' ? flagLabel(v) : formatValue('', v, ctx))).join(', ') || '—'
    }
    return value.map(v => formatValue('', v, ctx)).join(' · ')
  }
  return Object.entries(value)
    .map(([k, v]) => `${fieldLabel(k)}: ${formatValue(k, v, ctx)}`)
    .join(', ') || '—'
}

// ── Flags: why an entry is notable ───────────────────────────────────────

const FLAG_LABELS = {
  outside_the_till: 'Made outside the till',
  unexpected_actor: 'Not made by a till',
  price_changed: 'Price changed',
  member_discount_removed: 'Member discount removed',
  stock_typed_in: 'Stock figure typed in',
  arrived_late: 'Arrived late',
  till_claim_mismatch: 'Till name does not match the till that sent it',
  no_staff_on_sale: 'No staff member on the sale',
  staff_unverified: 'Staff member not confirmed',
  voided: 'Voided',
  direct_edit_of_sale: 'Sale edited directly',
  tier_changed: 'Staff status changed',
  pin_changed: 'PIN changed',
  direct_edit_of_protected_field: 'Protected figure edited directly',
  till_registration_changed: 'Till registration changed',
  report_recipients_changed: 'Report email list changed',
  below_list_price: 'Sold below list price',
  table_emptied: 'Everything wiped at once',
  history_rewrite_attempt: 'Attempt to change past records',
}

export function flagLabel(flag) {
  return FLAG_LABELS[flag] ?? upperFirst(prettify(flag))
}

/** The entry's own flags plus those of the sale lines folded into it. */
export function entryFlags(entry) {
  const own = asList(asObj(asObj(entry).detail).flags)
  const lines = asList(asObj(asObj(asObj(entry).sale_lines).detail).flags)
  return [...new Set([...own, ...lines])].filter(f => typeof f === 'string')
}

function flagTags(entry) {
  const detail = asObj(entry.detail)
  return entryFlags(entry).map(flag => {
    if (flag === 'arrived_late' && Number.isFinite(Number(detail.late_by_seconds))) {
      const late = Number(detail.late_by_seconds)
      return late < 0 ? `Dated ${duration(late)} in the future` : `Arrived ${duration(late)} late`
    }
    return flagLabel(flag)
  })
}

/** Highest severity of the entry and anything folded into it. */
export function entrySeverity(entry) {
  const own = Number(asObj(entry).severity) || 0
  const lines = Number(asObj(asObj(entry).sale_lines).severity) || 0
  return Math.max(0, Math.min(3, Math.max(own, lines)))
}

/** The entry numbers that still need marking as checked. */
export function uncheckedSeqs(entry) {
  return [entry, asObj(entry).sale_lines]
    .filter(e => e && Number(e.severity) >= 2 && !e.checked && e.seq !== null && e.seq !== undefined)
    .map(e => e.seq)
}

// ── Who, and how sure ────────────────────────────────────────────────────

export const TRUST_LABELS = {
  pin: 'PIN checked',
  session_record: 'matched a sign-in',
  claimed: 'said to be',
  none: 'nobody signed in',
}

/**
 * Who the log attributes an entry to, and how sure it is.
 * -> { name, tag, trust }  (name is null when nobody can be named)
 */
export function describeWho(entry) {
  const e = asObj(entry)
  const trust = TRUST_LABELS[e.staff_trust] ? e.staff_trust : 'none'
  if (e.staff_id || e.staff_name) {
    return {
      name: e.staff_name || 'A staff member no longer on the list',
      tag: trust === 'none' ? 'not confirmed' : TRUST_LABELS[trust],
      trust,
    }
  }
  const via = String(e.via ?? '')
  switch (e.actor) {
    case 'database':
      if (via.startsWith('cron:')) return { name: 'Automatic job', tag: null, trust: 'none' }
      if (via.startsWith('migration:')) return { name: 'Database update', tag: null, trust: 'none' }
      return { name: 'Someone working directly in the database', tag: 'not through the till', trust: 'none' }
    case 'service':
      return { name: 'The system', tag: 'not a person at a till', trust: 'none' }
    case 'member':
      return { name: 'A member’s own login', tag: 'not a till', trust: 'none' }
    case 'anon':
      return { name: 'Someone not signed in to anything', tag: 'not a till', trust: 'none' }
    default:
      return { name: null, tag: TRUST_LABELS.none, trust: 'none' }
  }
}

const HTTP_VERB = { POST: 'adding to', PATCH: 'editing', PUT: 'editing', DELETE: 'deleting from', GET: 'reading' }

/** How an entry reached the database, in words. */
export function describeVia(via) {
  if (!via) return 'Not recorded'
  const text = String(via)
  if (text.startsWith('sql:')) {
    const [user, ...app] = text.slice(4).split('/')
    const tool = app.join('/')
    return `Typed straight into the database (as ${user || 'unknown'}${tool ? `, using ${tool}` : ''})`
  }
  if (text.startsWith('cron:')) return `Automatic job (${prettify(text.slice(5))})`
  if (text.startsWith('migration:')) return `Database update (${text.slice(10)})`
  if (text.startsWith('fn:')) {
    const [name, ...rest] = text.slice(3).split(' ')
    const inner = rest.join(' ').trim()
    return `Server function ${quote(name)}${inner ? ` — ${lowerFirst(describeVia(inner))}` : ''}`
  }
  const m = /^([A-Z]+)\s+\/(.*)$/.exec(text)
  if (m) {
    const path = m[2]
    if (path.startsWith('rpc/')) return `Through the app’s routine ${quote(path.slice(4))}`
    const table = path.split(/[/?]/)[0]
    return `Straight to the ${tableNoun(table, true)} list (${HTTP_VERB[m[1]] ?? m[1].toLowerCase()})`
  }
  return prettify(text)
}

function lowerFirst(text) {
  return text ? text.charAt(0).toLowerCase() + text.slice(1) : text
}

/**
 * When the thing actually happened, if that differs from when the log
 * received it by more than two minutes (an offline sale sent in later, a
 * queued till report). -> ISO string or null.
 */
export function happenedAt(entry) {
  const e = asObj(entry)
  const arrived = validDate(e.at)
  if (!arrived) return null
  let claimed = e.client_at
  if (!claimed && e.kind === 'row' && e.table === 'orders' && e.action === 'insert') {
    claimed = asObj(e.new).created_at
  }
  const happened = validDate(claimed)
  if (!happened) return null
  return Math.abs(arrived.getTime() - happened.getTime()) > 2 * 60 * 1000 ? happened.toISOString() : null
}

// ── Sales read as one line ───────────────────────────────────────────────

const isSaleInsert = e => e && e.kind === 'row' && e.table === 'orders' && e.action === 'insert'
const isLinesInsert = e => e && e.kind === 'row' && e.table === 'order_items' && e.action === 'insert'

/**
 * A sale is recorded as two entries: the sale itself and its lines. Where
 * both are in the list, fold the lines into the sale (as `sale_lines`) so
 * it reads "Sale of £13.80 on tab: 2 × Guinness, 1 × Crisps".
 */
export function combineSaleEntries(entries) {
  const list = asList(entries).filter(Boolean)
  const sales = new Set(list.filter(e => isSaleInsert(e) && e.pk).map(e => e.pk))
  const linesFor = new Map()
  const folded = new Set()
  for (const e of list) {
    if (isLinesInsert(e) && e.pk && sales.has(e.pk) && !linesFor.has(e.pk)) {
      linesFor.set(e.pk, e)
      folded.add(e)
    }
  }
  if (folded.size === 0) return list
  const used = new Set()
  return list
    .filter(e => !folded.has(e))
    .map(e => {
      if (isSaleInsert(e) && linesFor.has(e.pk) && !used.has(e.pk)) {
        used.add(e.pk)
        return { ...e, sale_lines: linesFor.get(e.pk) }
      }
      return e
    })
}

/** { [order id]: the sale as first recorded }, from the entries on screen. */
export function salesIndex(entries) {
  const index = {}
  for (const e of asList(entries)) {
    if (isSaleInsert(e) && e.pk && isObj(e.new)) index[e.pk] = e.new
  }
  return index
}

function saleItems(linesEntry, ctx) {
  const info = asObj(asObj(asObj(linesEntry).detail).lines)
  return asList(asObj(linesEntry).new).filter(isObj).map(row => {
    const meta = asObj(info[row.id])
    return {
      product: meta.product ?? nameOf(ctx, row.product_id) ?? 'an item',
      quantity: row.quantity,
      unit_price: row.unit_price,
      list_standard: meta.list_standard,
      list_member: meta.list_member,
      below: meta.below_list_price === true,
      for_staff: row.staff_credit_for ?? null,
    }
  })
}

function itemsText(items, max = 6) {
  const shown = items.slice(0, max).map(i => `${num(i.quantity)} × ${i.product}`)
  if (items.length > max) shown.push(`and ${items.length - max} more`)
  return shown.join(', ')
}

function itemsTotal(items) {
  return items.reduce((sum, i) => sum + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0), 0)
}

function itemNotes(items, ctx) {
  const notes = []
  for (const i of items) {
    if (i.below) {
      const list = i.list_standard !== undefined && i.list_standard !== null
        ? ` — list price ${money(i.list_standard)}${Number(i.list_member) !== Number(i.list_standard) && i.list_member !== undefined && i.list_member !== null ? `, members ${money(i.list_member)}` : ''}`
        : ''
      notes.push(`${i.product} sold at ${money(i.unit_price)} each${list}`)
    }
    if (i.for_staff) {
      const who = nameOf(ctx, i.for_staff)
      notes.push(`${num(i.quantity)} × ${i.product} bought as a drink for ${who ?? 'a staff member'}`)
    }
  }
  return notes
}

function saleSummary(sale, ctx) {
  const s = asObj(sale)
  const method = PAYMENT_WORDS[s.payment_method] ?? (s.payment_method ? `by ${s.payment_method}` : '')
  if (s.is_tab_settlement) {
    const who = nameOf(ctx, s.member_id)
    return `tab payment of ${money(s.total_amount)}${method ? ` ${method}` : ''}${who ? ` from ${who}` : ''}`
  }
  return `sale of ${money(s.total_amount)}${method ? ` ${method}` : ''}`
}

// ── Rows: what changed in the books ──────────────────────────────────────

function changedKeys(entry) {
  const listed = asList(entry.changed).filter(k => typeof k === 'string')
  if (listed.length) return listed
  return [...new Set([...Object.keys(asObj(entry.old)), ...Object.keys(asObj(entry.new))])]
}

function changeText(key, entry, ctx) {
  const before = asObj(entry.old)[key]
  const after = asObj(entry.new)[key]
  if (key === 'pin_hash') {
    if (before === null || before === undefined) return 'PIN set'
    if (after === null || after === undefined) return 'PIN cleared'
    return 'PIN changed'
  }
  const unknownId = v => typeof v === 'string' && UUID.test(v) && !nameOf(ctx, v)
  if (unknownId(before) || unknownId(after)) return `${fieldLabel(key)} changed`
  if (typeof after === 'boolean' && (before === null || before === undefined || typeof before === 'boolean')) {
    return `${fieldLabel(key)} switched ${after ? 'on' : 'off'}`
  }
  return `${fieldLabel(key)} from ${formatValue(key, before, ctx)} to ${formatValue(key, after, ctx)}`
}

function changeLines(entry, ctx, skip = []) {
  return changedKeys(entry).filter(k => !skip.includes(k)).map(k => upperFirst(changeText(k, entry, ctx)))
}

function genericRow(entry, ctx) {
  const noun = tableNoun(entry.table)
  const article = /^[aeiou]/i.test(noun) ? 'an' : 'a'
  switch (entry.action) {
    case 'insert': {
      const rows = asList(entry.new)
      return { title: rows.length > 1 ? `Added ${count(rows.length, noun, tableNoun(entry.table, true))}` : `Added ${article} ${noun}` }
    }
    case 'update': {
      const keys = changedKeys(entry)
      return {
        title: `Changed ${article} ${noun}${keys.length ? `: ${keys.map(fieldLabel).join(', ')}` : ''}`,
        lines: changeLines(entry, ctx),
      }
    }
    case 'delete':
      return { title: `Deleted ${article} ${noun}` }
    default:
      return { title: `${upperFirst(prettify(entry.action))} — ${noun}` }
  }
}

function productRow(entry, ctx) {
  const before = asObj(entry.old)
  const after = asObj(entry.new)
  const name = entry.subject || after.name || before.name || nameOf(ctx, entry.pk) || 'a product'
  if (entry.action === 'insert') {
    return {
      title: `Added product ${name} (standard ${money(after.standard_price)}, members ${money(after.member_price)})`,
      lines: after.active === false ? ['Added as not on sale'] : [],
      category: 'prices',
    }
  }
  if (entry.action === 'delete') {
    return { title: `Deleted product ${name}`, category: 'prices' }
  }
  if (entry.action !== 'update') return null

  const keys = changedKeys(entry)
  const part = key => {
    switch (key) {
      case 'standard_price':
      case 'member_price':
      case 'cost_price':
        return `${fieldLabel(key)} from ${money(before[key])} to ${money(after[key])}`
      case 'stock_quantity':
        return `stock count from ${num(before[key])} to ${num(after[key])}`
      case 'active':
        return after.active ? 'put back on sale' : 'taken off sale'
      case 'name':
        return `renamed from ${quote(before.name)} to ${quote(after.name)}`
      default:
        return changeText(key, entry, ctx)
    }
  }
  const category = keys.length === 1 && keys[0] === 'stock_quantity' ? 'stock' : 'prices'
  if (keys.length === 1) {
    const key = keys[0]
    if (key === 'active') return { title: after.active ? `Put ${name} back on sale` : `Took ${name} off sale`, category }
    if (key === 'name') return { title: `Renamed product ${quote(before.name)} to ${quote(after.name)}`, category }
    if (key === 'stock_quantity') {
      return { title: `Set ${name} stock count from ${num(before[key])} to ${num(after[key])} by typing it in`, category }
    }
    return { title: `Changed ${name} ${part(key)}`, category }
  }
  if (keys.length === 2) {
    return { title: `Changed ${name}: ${keys.map(part).join('; ')}`, category }
  }
  const prices = keys.filter(k => k === 'standard_price' || k === 'member_price')
  const lead = prices.length ? prices : keys.slice(0, 1)
  const rest = keys.filter(k => !lead.includes(k))
  return {
    title: `Changed ${name}: ${lead.map(part).join('; ')}${rest.length ? ` (and ${rest.map(fieldLabel).join(', ')})` : ''}`,
    lines: rest.map(k => upperFirst(part(k))),
    category,
  }
}

function priceChangeRow(entry, ctx) {
  if (entry.action !== 'insert') return null
  const r = asObj(entry.new)
  const name = nameOf(ctx, r.product_id) ?? 'a product'
  if (r.old_standard_price === null || r.old_standard_price === undefined) {
    return { title: `Opening prices noted for ${name}: standard ${money(r.new_standard_price)}, members ${money(r.new_member_price)}` }
  }
  const parts = []
  if (Number(r.old_standard_price) !== Number(r.new_standard_price)) {
    parts.push(`standard price from ${money(r.old_standard_price)} to ${money(r.new_standard_price)}`)
  }
  if (Number(r.old_member_price) !== Number(r.new_member_price)) {
    parts.push(`members’ price from ${money(r.old_member_price)} to ${money(r.new_member_price)}`)
  }
  return { title: `Price change noted for ${name}${parts.length ? `: ${parts.join('; ')}` : ''}` }
}

function orderRow(entry, ctx) {
  const before = asObj(entry.old)
  const after = asObj(entry.new)
  const detail = asObj(entry.detail)
  const via = String(entry.via ?? '')

  if (entry.action === 'insert') {
    const lines = []
    const items = entry.sale_lines ? saleItems(entry.sale_lines, ctx) : []
    let title = upperFirst(saleSummary(after, ctx))
    if (items.length && !after.is_tab_settlement) title += `: ${itemsText(items)}`
    lines.push(...itemNotes(items, ctx))

    const member = nameOf(ctx, after.member_id)
    if (member && !after.is_tab_settlement) {
      lines.push(after.payment_method === 'tab' ? `Put on ${possessive(member)} tab` : `Member: ${member}`)
    }
    if (after.status && after.status !== 'paid') lines.push(`Recorded as ${after.status}`)

    const rungBy = after.staff_id
    const rungTrust = detail.rung_by_trust
    if (rungBy && (rungBy !== entry.staff_id || (rungTrust && rungTrust !== entry.staff_trust))) {
      const who = nameOf(ctx, rungBy) ?? 'a staff member'
      lines.push(`The sale itself names ${who} as who rang it${rungTrust ? ` — ${TRUST_LABELS[rungTrust] ?? prettify(rungTrust)}` : ''}`)
    }
    if (entryFlags(entry).includes('till_claim_mismatch') && after.till_id && entry.till_id) {
      lines.push(`The sale says ${tillLabel(after.till_id)} but it was sent by ${tillLabel(entry.till_id)}`)
    }
    return { title, lines, category: after.is_tab_settlement ? 'tabs' : 'sales' }
  }

  if (entry.action === 'delete') {
    return { title: `Deleted a ${saleSummary(before, ctx)}`, category: before.is_tab_settlement ? 'tabs' : 'sales' }
  }
  if (entry.action !== 'update') return null

  const keys = changedKeys(entry)
  const known = asObj(asObj(ctx).sales)[entry.pk]
  const what = known ? `the ${saleSummary(known, ctx)}` : 'a sale'
  const context = known && known.created_at ? [`First recorded ${formatDateTime(known.created_at)}`] : []
  const category = known && known.is_tab_settlement ? 'tabs' : 'sales'

  if (keys.includes('status') && after.status === 'voided') {
    const title = via.includes('undo_tab_settlement')
      ? `Undid ${known ? `the ${saleSummary(known, ctx)}` : 'a tab payment'}`
      : `Voided ${what}`
    return { title, lines: [...changeLines(entry, ctx, ['status']), ...context], category: via.includes('undo_tab_settlement') ? 'tabs' : category }
  }
  if (keys.length === 1 && keys[0] === 'payment_method') {
    return {
      title: `Changed payment type of ${what} from ${PAYMENT_NAMES[before.payment_method] ?? before.payment_method} to ${PAYMENT_NAMES[after.payment_method] ?? after.payment_method}`,
      lines: context,
      category,
    }
  }
  if (keys.length === 1 && keys[0] === 'total_amount') {
    return { title: `Changed the total of ${what} from ${money(before.total_amount)} to ${money(after.total_amount)}`, lines: context, category }
  }
  if (keys.length === 1) {
    return { title: `Changed ${what}: ${changeText(keys[0], entry, ctx)}`, lines: context, category }
  }
  return {
    title: `Changed ${what}: ${keys.map(fieldLabel).join(', ')}`,
    lines: [...changeLines(entry, ctx), ...context],
    category,
  }
}

function orderItemsRow(entry, ctx) {
  if (entry.action === 'insert') {
    const items = saleItems(entry, ctx)
    if (!items.length) return { title: 'Sale lines recorded' }
    return {
      title: `Sale lines: ${itemsText(items)} (${money(itemsTotal(items))})`,
      lines: itemNotes(items, ctx),
    }
  }
  if (entry.action === 'delete') {
    const old = asObj(entry.old)
    const product = nameOf(ctx, old.product_id)
    const what = product ? `: ${has(old, 'quantity') ? `${num(old.quantity)} × ` : ''}${product}` : ''
    return { title: `Deleted a sale line${what}${has(old, 'unit_price') ? ` at ${money(old.unit_price)} each` : ''}` }
  }
  if (entry.action === 'update') {
    const keys = changedKeys(entry)
    return {
      title: `Changed a sale line${keys.length ? `: ${keys.map(k => changeText(k, entry, ctx)).join('; ')}` : ''}`,
    }
  }
  return null
}

const MOVEMENT_WORDS = {
  wastage: 'Wastage',
  spillage: 'Spillage',
  restock: 'Restock',
  adjustment: 'Stock adjustment',
  staff_drink: 'Staff drink',
  sale: 'Stock taken for a sale',
}

function movementItem(row, ctx) {
  return `${num(row.quantity)} × ${nameOf(ctx, row.product_id) ?? 'an item'}`
}

function stockRow(entry, ctx) {
  if (entry.action === 'insert') {
    const rows = asList(entry.new).filter(isObj)
    if (!rows.length) return { title: 'Stock record added' }
    const types = [...new Set(rows.map(r => r.type))]
    const notes = [...new Set(rows.map(r => r.notes).filter(Boolean))].map(n => `Note: ${n}`)
    const members = [...new Set(rows.map(r => nameOf(ctx, r.member_id)).filter(Boolean))].map(n => `For: ${n}`)
    if (types.length === 1) {
      const word = MOVEMENT_WORDS[types[0]] ?? upperFirst(prettify(types[0] ?? 'stock change'))
      return { title: `${word}: ${rows.slice(0, 6).map(r => movementItem(r, ctx)).join(', ')}${rows.length > 6 ? `, and ${rows.length - 6} more` : ''}`, lines: [...notes, ...members] }
    }
    return {
      title: `Stock changes: ${rows.slice(0, 6).map(r => `${lowerFirst(MOVEMENT_WORDS[r.type] ?? prettify(r.type))} ${movementItem(r, ctx)}`).join(', ')}${rows.length > 6 ? `, and ${rows.length - 6} more` : ''}`,
      lines: [...notes, ...members],
    }
  }
  if (entry.action === 'delete') {
    const old = asObj(entry.old)
    const word = lowerFirst(MOVEMENT_WORDS[old.type] ?? 'stock record')
    return { title: `Deleted a stock record (${word} ${movementItem(old, ctx)})` }
  }
  return null
}

function memberRow(entry, ctx) {
  const before = asObj(entry.old)
  const after = asObj(entry.new)
  const name = entry.subject || after.name || before.name || nameOf(ctx, entry.pk) || 'a member'
  // After a personal-data erasure the name itself reads "[erased]".
  const erased = name === '[erased]'
  const safeName = erased ? 'a member whose details were since erased' : name

  if (entry.action === 'insert') {
    const staff = after.membership_tier === 'staff'
    const lines = []
    if (staff) lines.push(after.pin_hash ? 'Added with a PIN already set' : 'No PIN yet')
    return {
      title: `Added ${staff ? 'staff member' : 'member'} ${safeName}${after.membership_number ? ` (${after.membership_number})` : ''}`,
      lines,
    }
  }
  if (entry.action === 'delete') {
    return { title: `Deleted ${before.membership_tier === 'staff' ? 'staff member' : 'member'} ${safeName}` }
  }
  if (entry.action !== 'update') return null

  const keys = changedKeys(entry)
  const quiet = ['last_settled_at']
  const main = keys.filter(k => !quiet.includes(k))
  const part = key => {
    switch (key) {
      case 'tab_balance':
        return `tab from ${money(before.tab_balance)} to ${money(after.tab_balance)}`
      case 'membership_tier':
        return `membership type from ${TIER_WORDS[before.membership_tier] ?? before.membership_tier} to ${TIER_WORDS[after.membership_tier] ?? after.membership_tier}`
      case 'active':
        return after.active ? 'made active again' : 'made inactive'
      case 'auth_user_id':
        return after.auth_user_id ? 'app login linked' : 'app login removed'
      default:
        return changeText(key, entry, ctx)
    }
  }
  if (main.length === 1) {
    const key = main[0]
    if (key === 'tab_balance') {
      return { title: `${possessive(safeName)} tab went from ${money(before.tab_balance)} to ${money(after.tab_balance)}`, category: 'tabs' }
    }
    if (key === 'pin_hash') {
      const what = changeText(key, entry, ctx)
      return { title: `${what} for ${safeName}`, category: 'signin' }
    }
    if (key === 'membership_tier') {
      return {
        title: after.membership_tier === 'staff' ? `Made ${safeName} a staff member` : `Took ${safeName} off the staff list`,
        lines: [`Membership type from ${TIER_WORDS[before.membership_tier] ?? before.membership_tier} to ${TIER_WORDS[after.membership_tier] ?? after.membership_tier}`],
      }
    }
    if (key === 'active') return { title: after.active ? `Made ${safeName} active again` : `Made ${safeName} inactive` }
    if (key === 'auth_user_id') return { title: after.auth_user_id ? `Linked an app login to ${safeName}` : `Removed the app login from ${safeName}` }
    if (erased) return { title: `Changed the ${fieldLabel(key)} of ${safeName}` }
    return { title: `Changed ${possessive(safeName)} ${part(key)}` }
  }
  if (main.length === 0) {
    return { title: `Updated ${possessive(safeName)} last tab payment time`, category: 'tabs' }
  }
  return {
    title: `Changed ${safeName}: ${main.map(fieldLabel).join(', ')}`,
    lines: main.map(k => upperFirst(part(k))),
    category: main.every(k => k === 'tab_balance') ? 'tabs' : 'people',
  }
}

function dealText(row) {
  const r = asObj(row)
  if (r.discount_type === 'percentage') return `${num(r.discount_value)}% off`
  if (r.discount_type === 'fixed_price') return `a fixed price of ${money(r.discount_value)}`
  return 'a deal'
}

function promotionRow(entry, ctx) {
  const before = asObj(entry.old)
  const after = asObj(entry.new)
  const name = after.name || before.name || nameOf(ctx, entry.pk)
  const label = name ? `promotion ${quote(name)}` : 'a promotion'
  if (entry.action === 'insert') return { title: `Added ${label}${after.active === false ? ' (switched off)' : ''}` }
  if (entry.action === 'delete') return { title: `Deleted ${label}` }
  if (entry.action !== 'update') return null
  const keys = changedKeys(entry)
  if (keys.length === 1 && keys[0] === 'active') return { title: `Switched ${after.active ? 'on' : 'off'} ${label}` }
  return { title: `Changed ${label}: ${keys.map(fieldLabel).join(', ')}`, lines: changeLines(entry, ctx) }
}

function promotionDealRow(entry, ctx) {
  const row = asObj(entry.action === 'delete' ? entry.old : entry.new)
  const promo = nameOf(ctx, row.promotion_id)
  const promoText = promo ? `promotion ${quote(promo)}` : 'a promotion'
  const target = entry.table === 'promotion_categories'
    ? (row.category ? `all ${row.category} products` : 'a group of products')
    : (nameOf(ctx, row.product_id) ?? 'a product')
  if (entry.action === 'insert') return { title: `Added ${target} to ${promoText} at ${dealText(row)}` }
  if (entry.action === 'delete') return { title: `Took ${target} out of ${promoText}` }
  if (entry.action === 'update') return { title: `Changed a deal in a promotion: ${changedKeys(entry).map(k => changeText(k, entry, ctx)).join('; ')}` }
  return null
}

function tabAdjustmentRow(entry, ctx) {
  const row = asObj(entry.action === 'delete' ? entry.old : entry.new)
  const who = nameOf(ctx, row.member_id)
  const tab = who ? `${possessive(who)} tab` : 'a tab'
  const amount = Number(row.amount)
  if (entry.action === 'insert') {
    const verb = amount < 0 ? `Took ${money(Math.abs(amount))} off ${tab}` : `Added ${money(amount)} to ${tab}`
    return { title: `${verb}${row.reason ? ` — reason: ${row.reason}` : ''}` }
  }
  if (entry.action === 'delete') return { title: `Deleted a tab adjustment of ${money(row.amount)}${who ? ` on ${tab}` : ''}` }
  return null
}

function correctionRow(entry) {
  if (entry.action !== 'insert') return null
  const r = asObj(entry.new)
  return {
    title: `Payment type corrected from ${PAYMENT_NAMES[r.old_method] ?? r.old_method} to ${PAYMENT_NAMES[r.new_method] ?? r.new_method}`,
  }
}

function cashbackRow(entry) {
  const r = asObj(entry.action === 'delete' ? entry.old : entry.new)
  if (entry.action === 'insert') return { title: `Cashback of ${money(r.amount)} given from the till` }
  if (entry.action === 'delete') return { title: `Deleted a cashback record of ${money(r.amount)}` }
  return null
}

function prizeRow(entry) {
  const r = asObj(entry.action === 'delete' ? entry.old : entry.new)
  if (entry.action === 'insert') return { title: `Prize payout of ${money(r.amount)}${r.machine ? ` (${r.machine})` : ''}` }
  if (entry.action === 'delete') return { title: `Deleted a prize payout of ${money(r.amount)}` }
  return null
}

function guestRow(entry, ctx) {
  const r = asObj(entry.action === 'delete' ? entry.old : entry.new)
  const host = nameOf(ctx, r.member_id)
  if (entry.action === 'insert') return { title: `Guest ${r.guest_name ?? ''} signed in${host ? ` by ${host}` : ''}`.replace(/\s+/g, ' ') }
  if (entry.action === 'delete') return { title: `Deleted the guest sign-in for ${r.guest_name ?? 'a guest'}` }
  return null
}

function dayCloseRow(entry, ctx) {
  const before = asObj(entry.old)
  const after = asObj(entry.new)
  if (entry.action === 'insert') {
    return {
      title: `Day closed for ${dateOnly(after.report_date)}: opening float ${money(after.opening_float)}, cash counted ${money(after.actual_cash)}`,
    }
  }
  if (entry.action === 'delete') return { title: `Deleted the day close for ${dateOnly(before.report_date)}` }
  if (entry.action === 'update') {
    const keys = changedKeys(entry).filter(k => k !== 'closed_at')
    return {
      title: `Day close figures changed${keys.length ? `: ${keys.map(k => changeText(k, entry, ctx)).join('; ')}` : ' (closed again)'}`,
    }
  }
  return null
}

function staffDrinkRow(entry, ctx) {
  const before = asObj(entry.old)
  const after = asObj(entry.new)
  if (entry.action === 'insert') {
    const who = nameOf(ctx, after.staff_member_id)
    const drink = nameOf(ctx, after.product_id)
    return { title: `Drink banked for ${who ?? 'a staff member'}${drink ? `: ${drink}` : ''} (${money(after.amount)})` }
  }
  if (entry.action === 'delete') return { title: `Deleted a banked staff drink (${money(before.amount)})` }
  if (entry.action === 'update') {
    const keys = changedKeys(entry)
    if (keys.includes('status')) {
      if (after.status === 'redeemed') return { title: 'Banked staff drink poured', lines: changeLines(entry, ctx, ['status']) }
      if (after.status === 'cancelled') return { title: 'Banked staff drink cancelled' }
      if (after.status === 'banked') return { title: 'Staff drink put back in the bank' }
    }
    return { title: `Changed a banked staff drink: ${keys.map(fieldLabel).join(', ')}`, lines: changeLines(entry, ctx) }
  }
  return null
}

function pinAttemptsRow(entry, ctx) {
  const before = asObj(entry.old)
  const after = asObj(entry.new)
  const who = nameOf(ctx, entry.pk) ?? 'a staff member'
  if (entry.action === 'delete') return { title: `Wrong-PIN count cleared for ${who}` }
  if (after.locked_until) return { title: `PIN locked for ${who} until ${formatTime(after.locked_until)}` }
  if (has(after, 'failed_count')) {
    const n = Number(after.failed_count)
    if (entry.action === 'update' && has(before, 'locked_until') && before.locked_until && !after.locked_until) {
      return { title: `PIN lock lifted for ${who}` }
    }
    return { title: `Wrong PIN counted for ${who} (${count(n, 'wrong try', 'wrong tries')} so far)` }
  }
  if (entry.action === 'update') return { title: `Wrong-PIN count updated for ${who}` }
  return null
}

function tillDeviceRow(entry) {
  const r = asObj(entry.action === 'delete' ? entry.old : entry.new)
  const label = [r.name, r.till_id ? `(${tillLabel(r.till_id)})` : null].filter(Boolean).join(' ')
  if (entry.action === 'insert') return { title: `Till registered${label ? `: ${label}` : ''}` }
  if (entry.action === 'delete') return { title: `Till registration removed${label ? `: ${label}` : ''}` }
  if (entry.action === 'update') return { title: `Till registration changed: ${changedKeys(entry).map(fieldLabel).join(', ')}` }
  return null
}

function recipientRow(entry) {
  const list = entry.table === 'monthly_report_recipients' ? 'monthly report email list' : 'day-close email list'
  const before = asObj(entry.old)
  const after = asObj(entry.new)
  if (entry.action === 'insert') return { title: `Added ${after.email ?? 'an address'} to the ${list}` }
  if (entry.action === 'delete') return { title: `Removed ${before.email ?? 'an address'} from the ${list}` }
  if (entry.action === 'update') {
    const keys = changedKeys(entry)
    if (keys.length === 1 && keys[0] === 'active') return { title: `Switched ${after.active ? 'on' : 'off'} an address on the ${list}` }
    if (keys.includes('email')) return { title: `Changed an address on the ${list} from ${before.email} to ${after.email}` }
    return { title: `Changed an address on the ${list}: ${keys.map(fieldLabel).join(', ')}` }
  }
  return null
}

function supplierRow(entry, ctx) {
  const before = asObj(entry.old)
  const after = asObj(entry.new)
  if (entry.action === 'insert') return { title: `Added supplier ${after.name ?? ''}`.trim() }
  if (entry.action === 'delete') return { title: `Deleted supplier ${before.name ?? ''}`.trim() }
  if (entry.action === 'update') return { title: `Changed a supplier: ${changedKeys(entry).map(fieldLabel).join(', ')}`, lines: changeLines(entry, ctx) }
  return null
}

function tabPaymentRow(entry, ctx) {
  const r = asObj(entry.action === 'delete' ? entry.old : entry.new)
  const who = nameOf(ctx, r.member_id)
  if (entry.action === 'insert') return { title: `Online tab payment of ${money(r.amount)}${who ? ` from ${who}` : ''}` }
  if (entry.action === 'delete') return { title: `Deleted an online tab payment of ${money(r.amount)}` }
  return null
}

const ROW_DESCRIBERS = {
  products: productRow,
  product_price_changes: priceChangeRow,
  orders: orderRow,
  order_items: orderItemsRow,
  stock_movements: stockRow,
  members: memberRow,
  promotions: promotionRow,
  promotion_items: promotionDealRow,
  promotion_categories: promotionDealRow,
  tab_adjustments: tabAdjustmentRow,
  order_corrections: correctionRow,
  cashback_transactions: cashbackRow,
  prize_wins: prizeRow,
  guest_signins: guestRow,
  z_reports: dayCloseRow,
  staff_drink_credits: staffDrinkRow,
  pin_attempts: pinAttemptsRow,
  till_devices: tillDeviceRow,
  z_report_recipients: recipientRow,
  monthly_report_recipients: recipientRow,
  suppliers: supplierRow,
  tab_payments: tabPaymentRow,
}

function describeRow(entry, ctx) {
  const category = TABLE_CATEGORY[entry.table] ?? 'other'
  if (entry.action === 'truncate') {
    return { title: `Every one of the ${tableNoun(entry.table, true)} was wiped in one go`, category }
  }
  const specific = ROW_DESCRIBERS[entry.table]?.(entry, ctx)
  const result = specific ?? genericRow(entry, ctx)
  return { category, ...result }
}

/** A record as a short phrase: "a sale of £7.40 by cash". Used for blocked attempts. */
function recordPhrase(table, row, ctx) {
  const r = asObj(row)
  switch (table) {
    case 'orders':
      return `a ${saleSummary(r, ctx)}`
    case 'order_items': {
      const product = nameOf(ctx, r.product_id)
      return `a sale line${product ? ` (${num(r.quantity)} × ${product} at ${money(r.unit_price)} each)` : has(r, 'unit_price') ? ` (${num(r.quantity)} at ${money(r.unit_price)} each)` : ''}`
    }
    case 'stock_movements':
      return `a stock record (${lowerFirst(MOVEMENT_WORDS[r.type] ?? 'stock change')} ${movementItem(r, ctx)})`
    case 'tab_adjustments':
      return `a tab adjustment of ${money(r.amount)}${r.reason ? ` (${r.reason})` : ''}`
    case 'order_corrections':
      return `a payment correction (${PAYMENT_NAMES[r.old_method] ?? r.old_method} to ${PAYMENT_NAMES[r.new_method] ?? r.new_method})`
    case 'cashback_transactions':
      return `a cashback record of ${money(r.amount)}`
    case 'prize_wins':
      return `a prize payout of ${money(r.amount)}`
    case 'guest_signins':
      return `the guest sign-in for ${r.guest_name ?? 'a guest'}`
    case 'product_price_changes':
      return `a price change record${nameOf(ctx, r.product_id) ? ` for ${nameOf(ctx, r.product_id)}` : ''}`
    case 'tab_payments':
      return `an online tab payment of ${money(r.amount)}`
    case 'members':
      return `${r.membership_tier === 'staff' ? 'staff member' : 'member'} ${r.name ?? ''}`.trim()
    case 'products':
      return `product ${r.name ?? ''}`.trim()
    case 'z_reports':
      return `the day close for ${dateOnly(r.report_date)}`
    case 'staff_drink_credits':
      return `a banked staff drink (${money(r.amount)})`
    default: {
      const noun = tableNoun(table)
      return `${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}`
    }
  }
}

// ── Guards: attempts to rewrite history ──────────────────────────────────

function describeGuard(entry, ctx) {
  const [mode, op] = String(entry.action ?? '').split('.')
  const what = recordPhrase(entry.table, entry.old, ctx)
  const subject = entry.subject && !what.includes(entry.subject) ? ` (${entry.subject})` : ''
  const lines = []
  if (op === 'update') {
    const before = asObj(entry.old)
    const after = asObj(entry.new)
    for (const key of Object.keys(after)) {
      if (JSON.stringify(after[key]) !== JSON.stringify(before[key])) {
        lines.push(`Tried to change ${changeText(key, { old: before, new: after }, ctx)}`)
      }
    }
  }
  const verb = op === 'delete' ? 'delete' : op === 'update' ? 'edit' : prettify(op || 'change')
  if (mode === 'blocked') {
    return {
      title: `Blocked: an attempt to ${verb} ${what}${subject} directly`,
      lines: [...lines, 'Nothing was changed. The till app never does this, so it is worth asking who did.'],
      category: 'blocked',
    }
  }
  if (mode === 'would_block') {
    return {
      title: `Allowed, but should not happen: ${what}${subject} was ${op === 'delete' ? 'deleted' : 'edited'} directly`,
      lines: [...lines, 'Protection of past records was in watch-only mode, so this went through.'],
      category: 'blocked',
    }
  }
  return { title: `Protection of past records: ${prettify(entry.action)} — ${what}`, lines, category: 'blocked' }
}

// ── Sign-ins and PINs ────────────────────────────────────────────────────

const PURPOSE_WORDS = {
  sign_in: 'signing in',
  z_report: 'the Z report',
  price_change: 'a price change',
  fix_payment: 'fixing a payment',
  undo_tab_payment: 'undoing a tab payment',
  unlock: 'unlocking the till',
  change_pin: 'changing a PIN',
  confirm: 'confirming an action',
}

const purposeText = purpose => PURPOSE_WORDS[purpose] ?? prettify(purpose)

const SIGN_OUT_WORDS = {
  sign_out: 'signed out',
  switch_user: 'signed out (switched to someone else)',
  idle_lock: 'was signed out when the till locked itself',
  close_day: 'was signed out when the day was closed',
  replaced: 'was signed out because someone else signed in on that till',
}

function describeAuth(entry, ctx) {
  const detail = asObj(entry.detail)
  const who = entry.subject || nameOf(ctx, entry.pk) || 'a staff member'
  const lines = []
  const askedFor = detail.purpose && detail.purpose !== 'sign_in' ? `The PIN was being asked for ${purposeText(detail.purpose)}` : null
  if (detail.for_signed_in_person === false && entry.staff_name) {
    lines.push(`${entry.staff_name} was the person signed in at the time`)
  }

  switch (entry.action) {
    case 'staff.sign_in':
      if (detail.trust === 'claimed') {
        lines.push('The PIN was checked the older way, so the log can only say this person is “said to be” who signed in')
      }
      return { title: `${upperFirst(who)} signed in`, lines, category: 'signin' }
    case 'staff.sign_out':
      return {
        title: `${upperFirst(who)} ${SIGN_OUT_WORDS[detail.reason] ?? `signed out${detail.reason ? ` (${prettify(detail.reason)})` : ''}`}`,
        lines,
        category: 'signin',
      }
    case 'pin.wrong_pin': {
      const left = detail.attempts_remaining
      const tries = left === null || left === undefined ? '' : ` — ${count(left, 'try', 'tries')} left`
      if (detail.purpose === 'change_pin') {
        return { title: `Wrong current PIN given while trying to change ${possessive(who)} PIN`, lines, category: 'signin' }
      }
      return { title: `Wrong PIN for ${who}${tries}`, lines: askedFor ? [askedFor, ...lines] : lines, category: 'signin' }
    }
    case 'pin.locked_now':
      return { title: `Too many wrong PINs for ${who} — locked for 15 minutes`, lines, category: 'signin' }
    case 'pin.locked':
      return { title: `PIN tried for ${who} while it was locked`, lines, category: 'signin' }
    case 'pin.no_pin':
      return { title: `PIN tried for ${who}, who has no PIN yet`, lines, category: 'signin' }
    case 'pin.not_staff':
      return {
        title: entry.subject ? `PIN tried for ${entry.subject}, who is not staff` : 'PIN tried for someone who is not staff',
        lines,
        category: 'signin',
      }
    case 'pin.confirmed':
      return { title: `${upperFirst(who)} confirmed their PIN for ${purposeText(detail.purpose ?? 'confirm')}`, lines, category: 'signin' }
    case 'pin.first_set':
      if (detail.set_by_self === false) {
        lines.push(entry.staff_name ? `${entry.staff_name} was signed in when it was set` : 'Nobody was signed in when it was set')
      }
      return { title: `First PIN set for ${who}`, lines, category: 'signin' }
    case 'pin.changed':
      if (detail.set_by_self === false && entry.staff_name) lines.push(`${entry.staff_name} was signed in when it was changed`)
      return { title: `PIN changed for ${who}`, lines, category: 'signin' }
    case 'pin.rejected':
      return { title: `PIN change for ${who} was refused`, lines, category: 'signin' }
    case 'session.claim_refused':
      return {
        title: `Refused: a till tried to mark ${who} as signed in without the PIN being checked`,
        lines,
        category: 'signin',
      }
    default:
      return { title: `Sign-in activity for ${who}: ${prettify(entry.action)}`, lines, category: 'signin' }
  }
}

// ── The log's own housekeeping ───────────────────────────────────────────

/** One problem from an integrity check, in words. */
export function describeProblem(problem) {
  const p = asObj(problem)
  const batch = p.seal !== undefined && p.seal !== null ? `sealed batch ${p.seal}` : 'a sealed batch'
  switch (p.problem) {
    case 'row_content_changed':
      return `Entry number ${p.seq ?? '?'} has been altered since it was recorded (${batch}).`
    case 'row_count_changed':
      return `${upperFirst(batch)} should hold ${count(p.expected, 'entry', 'entries')} but now holds ${num(p.found)} — entries have been removed or added.`
    case 'rows_do_not_match_seal':
      return `The entries in ${batch} no longer match their seal.`
    case 'chain_broken':
      return `The chain of seals is broken at ${batch} — an earlier seal has been changed or removed.`
    case 'seal_altered':
      return `The seal on ${batch} has itself been altered.`
    case 'seal_missing':
      return `${upperFirst(count(p.rows, 'entry points', 'entries point'))} to a seal that no longer exists.`
    case 'unsealed_row_content_changed':
      return `Entry number ${p.seq ?? '?'} (recent, not yet sealed) has been altered since it was recorded.`
    default:
      return `${upperFirst(prettify(p.problem ?? 'unknown problem'))}${p.seq ? ` (entry number ${p.seq})` : ''}.`
  }
}

/** A name from the coverage report as words: "order_items:insert" -> "new sale lines". */
export function coverageLabel(name) {
  const text = String(name ?? '')
  if (text.startsWith('auditlog.')) {
    const [table] = text.slice(9).split(':')
    const what = { log: 'the log itself', seals: 'the seals', acks: 'the “checked” marks', origins: 'the record of network addresses', device_ips: 'the record of till addresses', staff_sessions: 'the record of sign-ins' }[table]
    return `the lock on ${what ?? `the log’s ${prettify(table)}`}`
  }
  const [table, part] = text.split(':')
  if (part === 'insert') return `new ${tableNoun(table, true)}`
  return tableNoun(table, true)
}

function settingsChanges(entry) {
  const before = asObj(entry.old)
  const after = asObj(entry.new)
  const out = []
  if (before.capture_enabled !== after.capture_enabled) out.push(after.capture_enabled ? 'recording switched back on' : 'RECORDING SWITCHED OFF')
  if (before.guards_enforced !== after.guards_enforced) {
    out.push(after.guards_enforced ? 'protection of past records switched back on' : 'protection of past records put in watch-only mode')
  }
  if (before.session_max_hours !== after.session_max_hours) {
    out.push(`longest sign-in changed from ${num(before.session_max_hours)} to ${num(after.session_max_hours)} hours`)
  }
  return out
}

function describeSystem(entry, ctx) {
  const detail = asObj(entry.detail)
  switch (entry.action) {
    case 'auditlog.installed':
    case 'audit.installed':
      return { title: 'Recording started here — nothing before this entry was captured', category: 'system' }
    case 'device.new_address':
      return {
        title: `${entry.till_id ? tillLabel(entry.till_id) : 'A till'} was seen from a network address it has not used before${detail.ip ? ` (${detail.ip})` : ''}`,
        lines: ['Expected after a router change or a new internet line. Otherwise, the till’s sign-in may be in use somewhere else.'],
        category: 'system',
      }
    case 'integrity.ok':
      return {
        title: `Nightly check passed${has(detail, 'rows_checked') ? `: all ${count(detail.rows_checked, 'entry', 'entries')} intact` : ''}`,
        category: 'system',
      }
    case 'integrity.checked':
      return {
        title: `Check run by hand: passed${has(detail, 'rows_checked') ? ` — all ${count(detail.rows_checked, 'entry', 'entries')} intact` : ''}`,
        category: 'system',
      }
    case 'integrity.FAILED': {
      const problems = asList(detail.problems)
      return {
        title: `CHECK FAILED: the log has been tampered with or damaged${problems.length ? ` (${count(problems.length, 'problem')})` : ''}`,
        lines: problems.map(describeProblem),
        category: 'system',
      }
    }
    case 'integrity.witness_mismatch':
      return {
        title: `${entry.till_id ? tillLabel(entry.till_id) : 'A till'} remembered a seal the database no longer has`,
        lines: ['History may have been rewritten, or the database was restored from a backup.'],
        category: 'system',
      }
    case 'coverage.gap': {
      const missing = asList(detail.missing).map(coverageLabel)
      const disabled = asList(detail.disabled).map(coverageLabel)
      const lines = []
      if (missing.length) lines.push(`Not being recorded: ${missing.join(', ')}`)
      if (disabled.length) lines.push(`Switched off: ${disabled.join(', ')}`)
      return { title: 'Part of the recording is missing or has been switched off', lines, category: 'system' }
    }
    case 'capture.failures':
      return {
        title: `${upperFirst(count(detail.last_24h ?? '?', 'change', 'changes'))} could not be recorded in the last 24 hours`,
        category: 'system',
      }
    case 'settings.changed': {
      const changes = settingsChanges(entry)
      return {
        title: `The log’s own settings were changed${changes.length ? `: ${changes.join('; ')}` : ''}`,
        category: 'system',
      }
    }
    case 'log.viewed': {
      const filter = asObj(detail.filter)
      const lines = []
      if (filter.q) lines.push(`Searched for ${quote(filter.q)}`)
      if (filter.table && filter.pk) lines.push(`Looked at the history of one ${tableNoun(filter.table)}`)
      return { title: 'Opened the log', lines, category: 'system' }
    }
    case 'alert.checked':
      return {
        title: `Marked alert number ${entry.pk ?? '?'} as checked`,
        lines: detail.note ? [`Note: ${detail.note}`] : [],
        category: 'system',
      }
    case 'privacy.erased': {
      const who = entry.subject || nameOf(ctx, entry.pk)
      return {
        title: `Personal details erased from the log for ${who ?? 'a member'}${has(detail, 'entries') ? ` (${count(detail.entries, 'entry', 'entries')})` : ''}`,
        lines: detail.reason ? [`Reason: ${detail.reason}`] : [],
        category: 'system',
      }
    }
    default:
      return {
        title: `Log housekeeping: ${prettify(entry.action)}`,
        lines: detail.note ? [String(detail.note)] : [],
        category: 'system',
      }
  }
}

// ── What the till app reported ───────────────────────────────────────────

const PAGE_NAMES = {
  '/': 'Till',
  '/stock': 'Stock',
  '/members': 'Members',
  '/tabs': 'Tabs',
  '/guests': 'Guests',
  '/promos': 'Promos',
  '/reports': 'Reports',
  '/stocktake': 'Stocktake',
  '/monthly-report': 'Monthly report',
  '/log': 'Log',
  '/settings': 'Settings',
}

const REPORT_NAMES = {
  daily: 'daily report',
  z_report: 'Z report',
  monthly: 'monthly report',
  stocktake: 'stocktake',
  price_changes: 'price changes list',
}

const BUNDLE_NAMES = {
  bottles_5_for_4: '5 bottles for the price of 4',
  shots_4_for_10: '4 shots for £10',
}

const PRINT_WORDS = {
  receipt: 'Receipt',
  tab_summary: 'Tabs summary',
  tab_statement: 'Tab statement',
  test: 'Test receipt',
}

const DRAWER_SOURCES = { settings: 'the Settings page', cashback: 'cashback', prize_win: 'a prize payout' }

function reportText(detail) {
  const name = REPORT_NAMES[detail.report] ?? (detail.report ? `${prettify(detail.report)} report` : 'report')
  let when = ''
  if (detail.date) when = ` for ${dateOnly(detail.date)}`
  else if (detail.month) when = ` for ${detail.month}`
  else if (detail.from && detail.to) when = ` for ${dateOnly(detail.from)} to ${dateOnly(detail.to)}`
  return `the ${name}${when}`
}

function eventCategory(type) {
  const area = String(type ?? '').split('.')[0]
  if (area === 'cart' || area === 'sale' || area === 'sales') return 'sales'
  if (area === 'pricing') return 'prices'
  if (area === 'tab' || area === 'drawer' || area === 'day') return 'tabs'
  if (area === 'device' || area === 'till' || area === 'pin_gate') return 'signin'
  if (area === 'integrity') return 'system'
  return 'till'
}

function memberFrom(detail, ctx) {
  return detail.member_name || detail.member || nameOf(ctx, detail.member_id) || null
}

function describeEvent(entry, ctx) {
  const d = asObj(entry.detail)
  const category = eventCategory(entry.action)
  const lines = []
  const out = (title, extra = []) => ({ title, lines: [...extra, ...lines], category })

  if (d.truncated) lines.push('The till sent more detail than the log keeps, so it was left out')
  if (Number(d.events_dropped_before_this) > 0) {
    lines.push(`${upperFirst(count(d.events_dropped_before_this, 'earlier till report was', 'earlier till reports were'))} lost before this one`)
  }

  switch (entry.action) {
    case 'app.started':
      return out(`Till app started${d.build ? ` (version ${d.build})` : ''}`, d.online === false ? ['It started without a connection'] : [])
    case 'app.error':
      return out(`The till app hit an error${d.message ? `: ${d.message}` : ''}`)
    case 'app.davey_mode':
      return out('Davey mode opened')
    case 'connection.lost':
      return out('Till lost its connection')
    case 'connection.restored':
      return out('Till back online')
    case 'page.viewed':
      return out(`Opened the ${PAGE_NAMES[d.path] ?? (d.path ? quote(d.path) : 'a')} page`)

    case 'device.signed_in':
      return out('Till device signed in')
    case 'device.sign_in_failed':
      return out(`Till device sign-in failed${d.email ? ` for ${d.email}` : ''}${d.message ? ` — ${d.message}` : ''}`)
    case 'device.signed_out':
      return out('Till device signed out')

    case 'till.locked': {
      if (d.reason === 'idle') return out(`Till locked itself after ${count(d.minutes ?? '?', 'minute')} of nobody using it`)
      if (d.reason === 'manual') return out('Till locked with the Lock button')
      return out(`Till locked${d.reason ? ` (${prettify(d.reason)})` : ''}`)
    }
    case 'till.unlocked':
      return out(d.via === 'sign_in' ? 'Till unlocked by someone signing in' : 'Till unlocked with a PIN')
    case 'till.unlocked_unverified':
      return out('Till unlocked WITHOUT a PIN check', ['The PIN could not be checked (usually no connection), and someone chose to carry on'])
    case 'till.lock_skipped_offline':
      return out('Till stayed unlocked while idle because it was offline')
    case 'pin_gate.cancelled':
      return out(`Backed out of the PIN check for ${purposeText(d.purpose ?? 'confirm')}`)

    case 'sync.replayed': {
      const parts = []
      if (Number(d.orders) > 0) parts.push(count(d.orders, 'saved-up sale'))
      if (Number(d.stock_movements) > 0) parts.push(count(d.stock_movements, 'stock record'))
      return out(`Sent ${parts.length ? parts.join(' and ') : 'saved-up work'} after being offline`)
    }
    case 'sync.failed': {
      const what = d.what === 'order' ? ['saved-up sale', 'saved-up sales'] : d.what === 'stock_movement' ? ['stock record', 'stock records'] : ['saved-up item', 'saved-up items']
      return out(`Could not send ${count(d.count ?? 1, what[0], what[1])}${d.message ? `: ${d.message}` : ''}`)
    }

    case 'cart.line_removed': {
      const extra = []
      if (d.for_staff) extra.push(`It was a drink for ${d.for_staff}`)
      if (d.bundle) extra.push('It was part of a deal')
      return out(`Removed ${num(d.quantity ?? 1)} × ${d.product ?? 'an item'}${has(d, 'value') ? ` (${money(d.value)})` : ''} from an order before payment`, extra)
    }
    case 'cart.quantity_reduced': {
      const extra = []
      if (d.for_staff) extra.push(`It was a drink for ${d.for_staff}`)
      if (d.bundle) extra.push('It was part of a deal')
      return out(`Cut ${d.product ?? 'an item'} from ${num(d.from)} to ${num(d.to)}${has(d, 'value_removed') ? ` (${money(d.value_removed)} less)` : ''} on an order before payment`, extra)
    }
    case 'cart.bundle_quantity_increased':
      return out(`Raised ${d.product ?? 'an item'} from ${num(d.from)} to ${num(d.to)} at the deal price${has(d, 'unit_price') ? ` (${money(d.unit_price)} each)` : ''}`)
    case 'cart.order_voided': {
      const items = asList(d.items).filter(isObj)
      const who = memberFrom(d, ctx)
      const extra = []
      if (items.length) extra.push(items.map(i => `${num(i.quantity)} × ${i.product ?? 'an item'}${has(i, 'value') ? ` (${money(i.value)})` : ''}`).join(', '))
      if (who) extra.push(`Member on the order: ${who}`)
      return out(`Cleared a whole order before payment: ${count(d.lines ?? items.length, 'line')}${has(d, 'value') ? ` worth ${money(d.value)}` : ''}`, extra)
    }
    case 'cart.member_attached': {
      const who = memberFrom(d, ctx)
      return out(`Put ${who ?? 'a member'} on the order`, d.method ? [`Found by ${prettify(d.method)}`] : [])
    }
    case 'cart.member_cleared': {
      const who = memberFrom(d, ctx)
      const kept = Number(d.lines_at_member_price)
      return out(`Took ${who ?? 'the member'} off the order`, kept > 0 ? [`${upperFirst(count(kept, 'line'))} already on the order kept the members’ price`] : [])
    }
    case 'cart.bundle_added': {
      const items = asList(d.items).filter(isObj)
      return out(
        `Added a deal to the order: ${BUNDLE_NAMES[d.bundle] ?? prettify(d.bundle ?? 'deal')}${has(d, 'value') ? ` (${money(d.value)})` : ''}`,
        items.length ? [items.map(i => `${num(i.quantity)} × ${i.product ?? 'an item'}`).join(', ')] : [],
      )
    }

    case 'cart.staff_credit_added': {
      const who = d.for_staff_name || nameOf(ctx, d.for_staff_id) || 'a staff member'
      return out(`Rang ${d.product ?? 'a drink'} as a drink for ${who}`, d.self_award ? ['They rang it for themselves'] : [])
    }

    case 'sales.recent_viewed':
      return out('Opened the list of today’s sales (Fix Payment)')

    case 'pricing.members_only_mode_on':
      return out('Members-only pricing switched on')
    case 'pricing.members_only_mode_off':
      return out(`Members-only pricing switched off${d.reason === 'staff_signed_out' ? ' (automatically, when the staff member signed out)' : ''}`)

    case 'sale.completed': {
      const how = PAYMENT_WORDS[d.method] ?? (d.method ? `by ${d.method}` : '')
      const what = `${money(d.total)}${how ? ` ${how}` : ''}`
      const extra = []
      if (has(d, 'lines')) extra.push(count(d.lines, 'line'))
      if (d.printed === false) extra.push('No receipt was printed')
      if (d.saved === 'failed') {
        const items = asList(d.items).filter(isObj)
        if (items.length) {
          extra.push(items.map(i => `${num(i.quantity)} × ${nameOf(ctx, i.product_id) ?? 'an item'} at ${money(i.unit_price)}`).join(', '))
        }
        return out(`SALE NOT SAVED: ${what} was taken but could not be stored anywhere`, extra)
      }
      if (d.saved === 'online' || d.saved === undefined || d.saved === null) return out(`Sale of ${what} completed`, extra)
      return out(`Sale of ${what} kept on the till to send later (no connection)`, extra)
    }
    case 'sale.cash_tendered':
      return out(`${d.tab_payment ? 'Cash tab payment' : 'Cash sale'} of ${money(d.total)}: ${money(d.tendered)} handed over, ${money(d.change)} change`)

    case 'drawer.opened_no_sale':
      return out(`Cash drawer opened without a sale${d.source ? ` (from ${DRAWER_SOURCES[d.source] ?? prettify(d.source)})` : ''}`)
    case 'drawer.open_failed':
      return out(`Cash drawer did not open${d.source ? ` (${DRAWER_SOURCES[d.source] ?? prettify(d.source)})` : ''}${d.message ? `: ${d.message}` : ''}`)
    case 'printer.test_printed':
      return out(d.ok === false ? 'Test receipt failed to print' : 'Test receipt printed')
    case 'receipt.print_failed':
      return out(`${PRINT_WORDS[d.what] ?? 'Receipt'} failed to print${d.message ? `: ${d.message}` : ''}`)

    case 'settings.printer_ip_changed':
      return out(`Printer address changed from ${d.from ? d.from : 'nothing'} to ${d.to ? d.to : 'nothing'}`, d.to ? [] : ['With no printer address, receipts do not print and the cash drawer does not open'])
    case 'settings.idle_lock_changed':
      return out(Number(d.to) === 0
        ? `Automatic locking switched off (was ${count(d.from, 'minute')})`
        : `Automatic lock time changed from ${count(d.from, 'minute')} to ${count(d.to, 'minute')}`)

    case 'report.viewed':
      return out(`Looked at ${reportText(d)}`)
    case 'report.exported':
      return out(`Exported ${reportText(d)}${has(d, 'rows') ? ` (${count(d.rows, 'line')})` : ''}`)
    case 'report.emailed':
      return out(`Emailed ${reportText(d)}`, d.seal ? [`Seal ${d.seal} was included in the email`] : [])
    case 'report.email_failed':
      return out(`Could not email ${reportText(d)}${d.message ? `: ${d.message}` : ''}`)

    case 'day.closed': {
      const overShort = v => {
        const pence = Math.round(Number(v) * 100)
        if (!Number.isFinite(pence)) return 'difference not known'
        if (pence === 0) return 'exactly right'
        return `${money(Math.abs(pence) / 100)} ${pence > 0 ? 'over' : 'short'}`
      }
      const extra = []
      for (const [till, t] of Object.entries(asObj(d.tills))) {
        if (!isObj(t)) continue
        extra.push(`${tillLabel(till)}: float ${money(t.opening_float)}, expected ${money(t.expected_cash)}, counted ${money(t.actual_cash)} — ${overShort(t.variance)}`)
      }
      return out(
        `Closed the day for ${dateOnly(d.date)}: cash counted ${money(d.actual_cash)}, expected ${money(d.expected_cash)} — ${overShort(d.variance)}`,
        extra,
      )
    }

    case 'tab.statement_printed':
      return out(`Printed a tab statement for ${memberFrom(d, ctx) ?? 'a member'}`)
    case 'tab.summary_printed':
      return out(`Printed the tabs summary${has(d, 'tabs') ? ` (${count(d.tabs, 'tab')}${has(d, 'total') ? `, ${money(d.total)}` : ''})` : ''}`)
    case 'tab.amount_revealed': {
      if (d.what === 'total_outstanding') return out('Revealed the total owed on all tabs')
      const who = memberFrom(d, ctx)
      return out(who ? `Revealed ${possessive(who)} tab amount` : 'Revealed a hidden tab amount')
    }
    case 'tab.order_removed': {
      const who = memberFrom(d, ctx)
      return out(`Removed a ${has(d, 'value') ? `${money(d.value)} ` : ''}sale from ${who ? `${possessive(who)} tab` : 'a tab'}`)
    }
    case 'tab.orders_viewed': {
      const who = memberFrom(d, ctx)
      return out(`Looked at the sales on ${who ? `${possessive(who)} tab` : 'a tab'}`)
    }

    case 'member.profile_viewed': {
      const who = memberFrom(d, ctx)
      return out(who ? `Opened ${possessive(who)} profile` : 'Opened a member’s profile')
    }
    case 'guests.viewed':
      return out(`Looked at the guest list${d.date ? ` for ${dateOnly(d.date)}` : ''}${has(d, 'guests') ? ` (${count(d.guests, 'guest')})` : ''}`)

    case 'integrity.seal_mismatch_seen':
      return out(`This till noticed its remembered seal${d.remembered ? ` (${d.remembered})` : ''} is no longer in the database`, ['History may have been rewritten, or the database was restored from a backup.'])

    default:
      return out(`Till reported: ${prettify(entry.action) || 'something'}`)
  }
}

// ── Entry point ──────────────────────────────────────────────────────────

function fallback(entry) {
  const e = asObj(entry)
  const what = prettify(e.action) || 'something happened'
  const where = e.table ? ` — ${tableNoun(e.table)}` : ''
  return { title: `${upperFirst(what)}${where}`, lines: [], tags: [], category: 'other' }
}

function tidy(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim()
}

/**
 * @param {object} entry  one entry from audit_view (optionally with
 *                        `sale_lines` folded in by combineSaleEntries)
 * @param {{ names?: object, sales?: object }} [ctx]
 * @returns {{ title: string, lines: string[], tags: string[], category: string }}
 */
export function describeEntry(entry, ctx = {}) {
  const e = asObj(entry)
  let result
  try {
    switch (e.kind) {
      case 'row': result = describeRow(e, ctx); break
      case 'auth': result = describeAuth(e, ctx); break
      case 'guard': result = describeGuard(e, ctx); break
      case 'system': result = describeSystem(e, ctx); break
      case 'event': result = describeEvent(e, ctx); break
      default: result = null
    }
  } catch {
    result = null
  }
  const base = fallback(e)
  let tags = []
  try { tags = flagTags(e) } catch { tags = [] }
  const title = upperFirst(tidy(result?.title))
  return {
    title: title || base.title,
    lines: asList(result?.lines).map(tidy).filter(Boolean),
    tags,
    category: result?.category || base.category,
  }
}
