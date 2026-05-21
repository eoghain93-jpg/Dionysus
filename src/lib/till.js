// Per-device till identifier. Each physical till is identified by a stable
// till_id stamped on every order, wastage entry, cashback, prize win and tab
// settlement so the audit trail shows which device rang what. Combined
// Z-reports just sum across till_ids.
//
// Resolution order (most robust last — explicit overrides win):
//   1. URL ?till=till-N      — captured at app load by bootstrapTillId,
//                              persisted to localStorage. Survives cache
//                              wipes if the device's bookmark/PWA start URL
//                              keeps the query param.
//   2. localStorage tillId   — explicit override if set manually.
//   3. printer_ip mapping    — DERIVED: every till already has its receipt
//                              printer IP configured, and the IPs are
//                              device-specific. Mapping printer → till_id
//                              means staff don't have to set tillId
//                              separately. If printer IP is wrong, receipts
//                              don't print and staff notice immediately —
//                              self-monitoring failure mode.
//   4. 'till-1' default      — keeps original device working with no setup.

const TILL_ID_KEY = 'tillId'
const PRINTER_IP_KEY = 'printer_ip'
const DEFAULT_TILL_ID = 'till-1'

// Printer IP → till_id mapping. Source of truth lives here. If you add a
// third till or move printers between tills, update this map and rebuild.
const PRINTER_IP_TO_TILL_ID = {
  '192.168.0.250': 'till-1',
  '192.168.0.249': 'till-2',
}

function readTillFromUrl() {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  const value = params.get('till')
  if (!value) return null
  // Accept only the till-N shape so a stray ?till=something doesn't poison
  // the audit trail with garbage.
  return /^till-\d+$/.test(value) ? value : null
}

export function bootstrapTillId() {
  const fromUrl = readTillFromUrl()
  if (fromUrl && typeof localStorage !== 'undefined') {
    localStorage.setItem(TILL_ID_KEY, fromUrl)
  }
}

export function getTillId() {
  if (typeof localStorage === 'undefined') return DEFAULT_TILL_ID

  const explicit = localStorage.getItem(TILL_ID_KEY)
  if (explicit) return explicit

  const printerIp = localStorage.getItem(PRINTER_IP_KEY)
  if (printerIp && PRINTER_IP_TO_TILL_ID[printerIp]) {
    return PRINTER_IP_TO_TILL_ID[printerIp]
  }

  return DEFAULT_TILL_ID
}
