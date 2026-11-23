import { describe, it, expect, vi } from 'vitest'

vi.mock('./supabase', () => ({ supabase: { from: vi.fn() } }))

import { rankPopular, usualFromItems, planUsual } from './favourites'

describe('rankPopular', () => {
  it('ranks products by units sold, best seller first', () => {
    const rows = [
      { product_id: 'a', quantity: 2 },
      { product_id: 'b', quantity: 5 },
      { product_id: 'a', quantity: 1 },
      { product_id: 'c', quantity: 1 },
    ]
    expect(rankPopular(rows)).toEqual(['b', 'a', 'c'])
  })

  it('keeps only the top sellers up to the limit', () => {
    const rows = [
      { product_id: 'a', quantity: 3 },
      { product_id: 'b', quantity: 2 },
      { product_id: 'c', quantity: 1 },
    ]
    expect(rankPopular(rows, 2)).toEqual(['a', 'b'])
  })

  it('ignores rows without a product and handles no history', () => {
    expect(rankPopular([{ product_id: null, quantity: 4 }])).toEqual([])
    expect(rankPopular(undefined)).toEqual([])
  })
})

describe('usualFromItems', () => {
  it('picks the products in the most orders, at the quantity usually bought', () => {
    const rows = [
      { order_id: 'o1', product_id: 'guinness', quantity: 2 },
      { order_id: 'o2', product_id: 'guinness', quantity: 2 },
      { order_id: 'o3', product_id: 'guinness', quantity: 1 },
      { order_id: 'o1', product_id: 'crisps', quantity: 1 },
      { order_id: 'o3', product_id: 'crisps', quantity: 1 },
      { order_id: 'o2', product_id: 'wine', quantity: 1 },
    ]
    expect(usualFromItems(rows)).toEqual([
      { product_id: 'guinness', quantity: 2 },
      { product_id: 'crisps', quantity: 1 },
    ])
  })

  it('needs a product in at least two orders before calling it a usual', () => {
    expect(usualFromItems([{ order_id: 'o1', product_id: 'guinness', quantity: 6 }])).toEqual([])
  })

  it('adds up split lines within one order and ignores drinks bought for staff', () => {
    const rows = [
      { order_id: 'o1', product_id: 'guinness', quantity: 1 },
      { order_id: 'o1', product_id: 'guinness', quantity: 1 },
      { order_id: 'o2', product_id: 'guinness', quantity: 2 },
      { order_id: 'o1', product_id: 'lager', quantity: 1, staff_credit_for: 's1' },
      { order_id: 'o2', product_id: 'lager', quantity: 1, staff_credit_for: 's1' },
    ]
    expect(usualFromItems(rows)).toEqual([{ product_id: 'guinness', quantity: 2 }])
  })
})

describe('planUsual', () => {
  const sambuca = { id: 'sam', name: 'Sambuca' }
  const tequila = { id: 'teq', name: 'Tequila' }
  const guinness = { id: 'gui', name: 'Guinness' }
  const bud = { id: 'bud', name: 'Budweiser' }
  const rules = { isShot: p => ['sam', 'teq'].includes(p.id), isBottle: p => p.id === 'bud' }

  it('puts four eligible shots on as one 4-for-£10 deal', () => {
    const plan = planUsual([{ product: sambuca, quantity: 4 }, { product: guinness, quantity: 1 }], rules)
    expect(plan.shotBundles).toEqual([[sambuca, sambuca, sambuca, sambuca]])
    expect(plan.singles).toEqual([{ product: guinness, quantity: 1 }])
  })

  it('makes a deal from a mix of eligible shots', () => {
    const plan = planUsual([{ product: sambuca, quantity: 2 }, { product: tequila, quantity: 2 }], rules)
    expect(plan.shotBundles).toEqual([[sambuca, sambuca, tequila, tequila]])
    expect(plan.singles).toEqual([])
  })

  it('sells shots that do not make a full deal normally', () => {
    const plan = planUsual([{ product: sambuca, quantity: 5 }, { product: tequila, quantity: 1 }], rules)
    expect(plan.shotBundles).toHaveLength(1)
    expect(plan.singles).toEqual([{ product: sambuca, quantity: 1 }, { product: tequila, quantity: 1 }])
  })

  it('leaves fewer than four shots as ordinary lines', () => {
    const plan = planUsual([{ product: sambuca, quantity: 3 }], rules)
    expect(plan.shotBundles).toEqual([])
    expect(plan.singles).toEqual([{ product: sambuca, quantity: 3 }])
  })

  it('applies 5-for-4 to bottles only while that deal is running', () => {
    const lines = [{ product: bud, quantity: 5 }]
    expect(planUsual(lines, rules).bottleBundles).toEqual([])
    expect(planUsual(lines, rules).singles).toEqual([{ product: bud, quantity: 5 }])
    expect(planUsual(lines, { ...rules, bottleDealOn: true }).bottleBundles).toEqual([[bud, bud, bud, bud, bud]])
  })
})
