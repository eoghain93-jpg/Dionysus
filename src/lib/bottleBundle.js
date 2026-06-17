// Shared constants and eligibility for the bottle "5 for the price of 4" deal.
// Kept out of the component file so the marker name can be imported by TillPage
// (for the toggle gate) without tripping react-refresh's component-only rule.

// Marker promotion that gates the deal. Staff toggle a promo with this EXACT
// name on (at kickoff) to reveal the "5 for 4 Bottles" button, and off after
// the match. See isBundleEnabled in lib/promos.js.
export const BOTTLE_BUNDLE_PROMO_NAME = 'Bottle 5-for-4'

// EXACT product names eligible for the deal — matched case-insensitively
// against the whole name (not substring), so "San Miguel 0%" and "Carlsberg 0%"
// are deliberately excluded and the draught "Carlsberg" is excluded by the
// category guard. Edit this list to change the lineup.
export const BOTTLE_BUNDLE_ELIGIBLE_NAMES = ['San Miguel', 'Carlsberg (Bottle)', 'Budweiser']

const ELIGIBLE = new Set(BOTTLE_BUNDLE_ELIGIBLE_NAMES.map(n => n.toLowerCase()))

export function isBottleBundleEligible(product) {
  if (product.category !== 'bottle') return false
  return ELIGIBLE.has(product.name.trim().toLowerCase())
}
