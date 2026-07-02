// Container maths for Cellar Intelligence: managers count kegs and cases,
// products.stock_quantity counts servings (pints, measures, bottles). These
// helpers translate between the two so every screen can speak both.

export function hasContainer(product) {
  return Boolean(product?.container_name) && Number(product?.servings_per_container) > 0
}

function plural(word, n) {
  if (n === 1 || word === 'each') return word
  return `${word}s`
}

// "4 kegs + 26 pints" — the manager's view of stock_quantity. Returns null
// when the product has no container config (or stock is negative, which is
// a data problem the raw number should surface, not a formatter).
export function formatContainerStock(product) {
  if (!hasContainer(product)) return null
  const qty = Number(product.stock_quantity ?? 0)
  if (qty < 0) return null
  const per = Number(product.servings_per_container)
  const containers = Math.floor(qty / per)
  // Round loose servings to 2dp — stock_quantity is numeric(10,2) but float
  // maths on the way here can leave dust.
  const loose = Math.round((qty - containers * per) * 100) / 100
  const parts = []
  if (containers > 0) parts.push(`${containers} ${plural(product.container_name, containers)}`)
  if (loose > 0 || containers === 0) parts.push(`${loose} ${plural(product.unit, loose)}`)
  return parts.join(' + ')
}

// Count-flow input → servings. `partial` is the fill fraction (0..1) of the
// open container ("roughly a third left in the tapped keg"). Rounded to
// whole servings: pretending to know the exact pint in a live keg is false
// precision that erodes trust in the numbers.
export function servingsFromCount(product, containers, partial = 0) {
  const per = Number(product?.servings_per_container)
  if (!hasContainer(product)) return Number(containers) || 0
  const whole = (Number(containers) || 0) * per
  const open = Math.round(Math.min(Math.max(Number(partial) || 0, 0), 1) * per)
  return whole + open
}

// "Counted 12 days ago" / "Counted today" / null when never counted.
// The honesty indicator: how much should the manager trust this number?
export function lastCountedLabel(product, now = new Date()) {
  if (!product?.last_counted_at) return null
  const days = Math.floor((now - new Date(product.last_counted_at)) / 86_400_000)
  if (days <= 0) return 'Counted today'
  if (days === 1) return 'Counted yesterday'
  return `Counted ${days} days ago`
}
