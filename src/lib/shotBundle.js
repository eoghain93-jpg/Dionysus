// Shared constants and eligibility for the always-on "4 shots for £10" deal.
// Kept out of the component file so the till can apply the deal elsewhere
// (e.g. a member's usual) with exactly the same rules as the pop-up.

export const SHOT_BUNDLE_QTY = 4
export const SHOT_BUNDLE_TOTAL = 10.00

// Only these spirits are eligible for the 4-for-£10 deal. Match is
// case-insensitive substring against product.name so "Sambuca Black",
// "Tequila Rose", etc. would also qualify if they were on the menu.
// To change the eligible list, edit this array — no DB migration needed.
export const SHOT_BUNDLE_ELIGIBLE_KEYWORDS = ['sambuca', 'fireball', 'tequila']

export function isShotBundleEligible(product) {
  if (product.category !== 'spirit') return false
  const lower = product.name.toLowerCase()
  return SHOT_BUNDLE_ELIGIBLE_KEYWORDS.some(kw => lower.includes(kw))
}
