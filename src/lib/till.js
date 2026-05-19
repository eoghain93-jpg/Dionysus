// Per-device till identifier. Each physical till is identified by a stable
// till_id stamped on every order, wastage entry, cashback, prize win and tab
// settlement so the audit trail shows which device rang what. Combined
// Z-reports just sum across till_ids.
//
// Resolution order (most resilient first):
//   1. URL query param   — ?till=till-2  (survives cache/localStorage wipes
//                          as long as the device's bookmark/homepage keeps it)
//   2. localStorage      — set once by `bootstrapTillId` from the URL param,
//                          or manually via DevTools
//   3. 'till-1'          — default, so the original device keeps working
//                          with no setup at all
//
// `bootstrapTillId` is called once on app load (main.jsx). If the URL has
// `?till=...`, that value wins and is persisted to localStorage — so a
// staff member who clears the browser cache mid-shift will still recover
// the right till_id next time they open the app via the bookmark.

const TILL_ID_KEY = 'tillId'
const DEFAULT_TILL_ID = 'till-1'

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
  return localStorage.getItem(TILL_ID_KEY) || DEFAULT_TILL_ID
}
