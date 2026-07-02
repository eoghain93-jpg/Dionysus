import { describe, it, expect } from 'vitest'
import { hasContainer, formatContainerStock, servingsFromCount, lastCountedLabel } from './containers'

const KEG = {
  name: 'Guinness',
  unit: 'pint',
  container_name: 'keg',
  servings_per_container: 88,
  stock_quantity: 378,
}

describe('hasContainer', () => {
  it('is true only with a name AND a positive servings figure', () => {
    expect(hasContainer(KEG)).toBe(true)
    expect(hasContainer({ ...KEG, container_name: null })).toBe(false)
    expect(hasContainer({ ...KEG, servings_per_container: 0 })).toBe(false)
    expect(hasContainer({ ...KEG, servings_per_container: null })).toBe(false)
    expect(hasContainer(null)).toBe(false)
  })
})

describe('formatContainerStock', () => {
  it('speaks manager: whole containers + loose servings', () => {
    expect(formatContainerStock(KEG)).toBe('4 kegs + 26 pints')
  })

  it('drops the loose part when stock divides exactly', () => {
    expect(formatContainerStock({ ...KEG, stock_quantity: 176 })).toBe('2 kegs')
  })

  it('shows loose servings alone below one container', () => {
    expect(formatContainerStock({ ...KEG, stock_quantity: 30 })).toBe('30 pints')
  })

  it('singularises one container and one serving', () => {
    expect(formatContainerStock({ ...KEG, stock_quantity: 89 })).toBe('1 keg + 1 pint')
  })

  it('shows zero stock as zero servings', () => {
    expect(formatContainerStock({ ...KEG, stock_quantity: 0 })).toBe('0 pints')
  })

  it('does not pluralise "each"', () => {
    const bar = { ...KEG, unit: 'each', container_name: 'box', servings_per_container: 48, stock_quantity: 50 }
    expect(formatContainerStock(bar)).toBe('1 box + 2 each')
  })

  it('returns null without container config or with negative stock (data problem — show raw)', () => {
    expect(formatContainerStock({ ...KEG, container_name: null })).toBe(null)
    expect(formatContainerStock({ ...KEG, stock_quantity: -3 })).toBe(null)
  })

  it('rounds float dust in the loose part', () => {
    expect(formatContainerStock({ ...KEG, stock_quantity: 88 + 26.000000000000004 }))
      .toBe('1 keg + 26 pints')
  })
})

describe('servingsFromCount', () => {
  it('converts containers + open-container fraction to whole servings', () => {
    expect(servingsFromCount(KEG, 4, 0.25)).toBe(4 * 88 + 22)
  })

  it('rounds the open container to whole servings — no false precision', () => {
    expect(servingsFromCount(KEG, 0, 1 / 3)).toBe(29)
  })

  it('clamps the fraction to 0..1', () => {
    expect(servingsFromCount(KEG, 1, 2)).toBe(176)
    expect(servingsFromCount(KEG, 1, -1)).toBe(88)
  })

  it('falls back to the raw count without container config', () => {
    expect(servingsFromCount({ unit: 'bottle' }, 14)).toBe(14)
  })
})

describe('lastCountedLabel', () => {
  const NOW = new Date('2026-07-02T18:00:00Z')

  it('is null when never counted', () => {
    expect(lastCountedLabel({}, NOW)).toBe(null)
  })

  it('says today / yesterday / N days ago', () => {
    expect(lastCountedLabel({ last_counted_at: '2026-07-02T09:00:00Z' }, NOW)).toBe('Counted today')
    expect(lastCountedLabel({ last_counted_at: '2026-07-01T09:00:00Z' }, NOW)).toBe('Counted yesterday')
    expect(lastCountedLabel({ last_counted_at: '2026-06-20T09:00:00Z' }, NOW)).toBe('Counted 12 days ago')
  })
})
