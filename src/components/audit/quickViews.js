// The Log page's quick views, and how the page's controls become filters
// for the database.
//
// QUICK_VIEWS is the one place that says what each button shows. Each view
// is a list of audit_view filters whose results are merged, because one
// filter cannot say "these tables OR till reports with these names":
//
//   kinds          'row' (a change to the books) · 'event' (reported by the
//                  till app) · 'auth' (sign-ins and PINs) · 'guard' (a
//                  blocked attempt to rewrite history) · 'system'
//   tables         which lists the change was in
//   action_prefix  the start of the entry's name, e.g. 'cart.'
//   min_severity   0 routine · 1 notable · 2 needs a look · 3 serious
//   unchecked      only alerts nobody has marked as checked
//   actors         who made the change: 'till' · 'member' (the phone app) ·
//                  'service' (a server function or the service key) ·
//                  'database' (dashboard, SQL, a migration) · 'anon'
//   flag           entries marked with this reason, e.g. 'stock_typed_in'
//   q              text the entry must contain
//
// To change what a button shows, edit its `filters`. Nothing else needs to
// know.

export const QUICK_VIEWS = [
  {
    id: 'attention',
    label: 'Needs a look',
    hint: 'Alerts nobody has marked as checked yet',
    // An unchecked alert stays here until someone checks it, however old.
    allDates: true,
    filters: [{ unchecked: true }],
  },
  {
    id: 'everything',
    label: 'Everything',
    hint: 'Every entry, newest first',
    filters: [{}],
  },
  {
    id: 'prices',
    label: 'Prices and products',
    hint: 'Price changes, products added or taken off sale, promotions, members-only pricing',
    filters: [
      { kinds: ['row', 'guard'], tables: ['products', 'product_price_changes', 'promotions', 'promotion_items', 'promotion_categories', 'suppliers'] },
      { kinds: ['event'], action_prefix: 'pricing.' },
    ],
  },
  {
    id: 'sales',
    label: 'Sales and voids',
    hint: 'Sales, voids, payment fixes, and anything taken off an order before payment',
    filters: [
      { kinds: ['row', 'guard'], tables: ['orders', 'order_items', 'order_corrections', 'staff_drink_credits'] },
      { kinds: ['event'], action_prefix: 'cart.' },
      { kinds: ['event'], action_prefix: 'sale.' },
    ],
  },
  {
    id: 'tabs',
    label: 'Tabs and cash',
    hint: 'Tab balances and payments, cashback, prize payouts, the cash drawer and closing the day',
    filters: [
      { kinds: ['row', 'guard'], tables: ['tab_adjustments', 'tab_payments', 'cashback_transactions', 'prize_wins', 'z_reports'] },
      { kinds: ['row'], tables: ['members'], q: 'tab_balance' },
      { kinds: ['event'], action_prefix: 'tab.' },
      { kinds: ['event'], action_prefix: 'drawer.' },
      { kinds: ['event'], action_prefix: 'day.' },
    ],
  },
  {
    id: 'stock',
    label: 'Stock',
    hint: 'Wastage, spillage, restocks, and stock figures typed in by hand',
    filters: [
      { kinds: ['row', 'guard'], tables: ['stock_movements'] },
      { kinds: ['row'], tables: ['products'], flag: 'stock_typed_in' },
    ],
  },
  {
    id: 'people',
    label: 'Members and staff',
    hint: 'Members added or changed, who is staff, PINs set or changed, guests',
    filters: [
      { kinds: ['row', 'guard'], tables: ['members', 'guest_signins', 'till_devices', 'z_report_recipients', 'monthly_report_recipients'] },
      { kinds: ['event'], action_prefix: 'member.' },
      { kinds: ['event'], action_prefix: 'guests.' },
    ],
  },
  {
    id: 'signins',
    label: 'Sign-ins',
    hint: 'Who signed in and out, wrong PINs, locks, and the till itself signing in',
    // Also shows who was signed in where and when.
    sessions: true,
    filters: [
      { kinds: ['auth'] },
      { kinds: ['row'], tables: ['pin_attempts'] },
      { kinds: ['event', 'system'], action_prefix: 'device.' },
      { kinds: ['event'], action_prefix: 'till.' },
    ],
  },
  {
    id: 'till',
    label: 'Till actions',
    hint: 'Everything the till app reported: reports opened, receipts, settings, going offline',
    filters: [{ kinds: ['event'] }],
  },
  {
    id: 'outside',
    label: 'Outside the till',
    hint: 'Changes made around the till app: directly in the database, or blocked attempts to change past records',
    filters: [
      // Everything not done by a till: the dashboard, SQL, migrations, server
      // functions, the phone app.
      { actors: ['database', 'service', 'member', 'anon'] },
      // A till writing straight into a sale or a protected field.
      { flag: 'direct_edit_of_sale' },
      { flag: 'direct_edit_of_protected_field' },
      { kinds: ['guard'] },
      { kinds: ['system'], action_prefix: 'device.' },
    ],
  },
]

export const DEFAULT_VIEW = 'attention'
export const PAGE_SIZE = 100

export function findView(id) {
  return QUICK_VIEWS.find(v => v.id === id) ?? QUICK_VIEWS.find(v => v.id === DEFAULT_VIEW)
}

const pad = n => String(n).padStart(2, '0')
const localDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const DAY = /^\d{4}-\d{2}-\d{2}$/

/** Today and yesterday, as the two values of the date boxes. */
export function defaultRange(now = new Date()) {
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  return { from: localDay(yesterday), to: localDay(now) }
}

/**
 * The date boxes as timestamps for the database: from the start of the
 * first day to the end of the last (the database treats `to` as "before").
 */
export function rangeToIso({ from, to } = {}) {
  const out = { from: null, to: null }
  if (DAY.test(from ?? '')) {
    const [y, m, d] = from.split('-').map(Number)
    out.from = new Date(y, m - 1, d).toISOString()
  }
  if (DAY.test(to ?? '')) {
    const [y, m, d] = to.split('-').map(Number)
    out.to = new Date(y, m - 1, d + 1).toISOString()
  }
  return out
}

const TABLE_NAME = /^[a-z][a-z0-9_]{0,62}$/

/** The record a /log?table=…&pk=… link points at, or null. */
export function recordFromParams(params) {
  const table = params?.get?.('table') ?? null
  const pk = params?.get?.('pk') ?? null
  if (!table || !pk || !TABLE_NAME.test(table) || pk.length > 100) return null
  return { table, pk }
}

/** Filters for the whole history of one record. A sale includes its lines. */
export function recordFilters({ table, pk }) {
  if (table === 'orders') return [{ table: 'orders', pk }, { table: 'order_items', pk }]
  return [{ table, pk }]
}

/**
 * Everything the page's controls say, as the list of filters to fetch.
 *
 * A filter that already carries its own `q` cannot take the search box as
 * well (the database accepts one piece of text per filter), so for those
 * the search text travels as `local_q` and is applied to the results on
 * the till (see fetchAuditEntries).
 */
export function buildFilters({ view, record = null, range, staffId, tillId, search } = {}) {
  const base = record ? recordFilters(record) : (view ?? findView(DEFAULT_VIEW)).filters
  const allDates = record ? true : !!view?.allDates
  const dates = allDates ? { from: null, to: null } : rangeToIso(range)
  const text = (search ?? '').trim()
  return base.map(filter => {
    const out = { ...filter }
    if (dates.from) out.from = dates.from
    if (dates.to) out.to = dates.to
    if (staffId) out.staff_id = staffId
    if (tillId) out.till_id = tillId
    if (text) {
      if (out.q) out.local_q = text
      else out.q = text
    }
    return out
  })
}
