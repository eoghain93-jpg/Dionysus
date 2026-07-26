import { describe, it, expect } from 'vitest'
import {
  TRADING_DAY_CUTOFF_HOURS,
  addDaysISO,
  tradingDayOf,
  tradingTodayISO,
  tradingDayRange,
  tradingRange,
} from './tradingDay'

describe('tradingDayOf', () => {
  it('keeps daytime orders on their calendar date', () => {
    expect(tradingDayOf('2026-07-05T12:30:00+00:00')).toBe('2026-07-05')
    expect(tradingDayOf('2026-07-05T21:59:00+00:00')).toBe('2026-07-05')
  })

  it('assigns after-midnight orders to the previous day (the session that started them)', () => {
    expect(tradingDayOf('2026-07-06T00:06:00+00:00')).toBe('2026-07-05')
    expect(tradingDayOf('2026-07-06T03:43:00+00:00')).toBe('2026-07-05')
    expect(tradingDayOf('2026-07-06T05:59:59+00:00')).toBe('2026-07-05')
  })

  it('starts the new day exactly at the cutoff', () => {
    expect(tradingDayOf('2026-07-06T06:00:00+00:00')).toBe('2026-07-06')
  })

  it('rolls across month and year boundaries', () => {
    expect(tradingDayOf('2026-07-01T01:00:00+00:00')).toBe('2026-06-30')
    expect(tradingDayOf('2027-01-01T02:00:00+00:00')).toBe('2026-12-31')
  })

  it('treats offset-less timestamps as UTC, the way PostgREST emits them', () => {
    // No zone designator: JS would parse this as LOCAL time, PostgREST
    // means UTC — tradingDayOf must normalise so any host TZ agrees
    expect(tradingDayOf('2026-07-06T01:00:00')).toBe('2026-07-05')
    expect(tradingDayOf('2026-07-06 01:00:00')).toBe('2026-07-05')
    expect(tradingDayOf('2026-07-06T12:00:00')).toBe('2026-07-06')
  })

  it('handles explicit-offset timestamps', () => {
    expect(tradingDayOf('2026-07-06T01:00:00Z')).toBe('2026-07-05')
    expect(tradingDayOf('2026-07-06T01:23:45.678+00:00')).toBe('2026-07-05')
  })
})

describe('tradingTodayISO', () => {
  it('is yesterday before the cutoff and today after it', () => {
    expect(tradingTodayISO(new Date('2026-07-12T01:52:00Z'))).toBe('2026-07-11')
    expect(tradingTodayISO(new Date('2026-07-12T11:00:00Z'))).toBe('2026-07-12')
  })
})

describe('tradingDayRange / tradingRange', () => {
  it('spans 06:00 to 06:00 exclusive', () => {
    expect(tradingDayRange('2026-07-05')).toEqual({
      from: '2026-07-05T06:00:00',
      to: '2026-07-06T06:00:00',
    })
  })

  it('crosses month ends', () => {
    expect(tradingDayRange('2026-06-30').to).toBe('2026-07-01T06:00:00')
  })

  it('spans multi-day ranges inclusively', () => {
    expect(tradingRange('2026-07-01', '2026-07-31')).toEqual({
      from: '2026-07-01T06:00:00',
      to: '2026-08-01T06:00:00',
    })
  })
})

describe('addDaysISO', () => {
  it('adds and subtracts days across boundaries', () => {
    expect(addDaysISO('2026-07-31', 1)).toBe('2026-08-01')
    expect(addDaysISO('2026-03-01', -1)).toBe('2026-02-28')
  })
})

describe('cutoff constant', () => {
  it('sits in the closed hours (after any late session, before opening)', () => {
    expect(TRADING_DAY_CUTOFF_HOURS).toBeGreaterThanOrEqual(5)
    expect(TRADING_DAY_CUTOFF_HOURS).toBeLessThanOrEqual(10)
  })
})
