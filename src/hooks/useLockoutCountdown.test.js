import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useLockoutCountdown } from './useLockoutCountdown'

afterEach(() => {
  vi.useRealTimers()
})

describe('useLockoutCountdown', () => {
  it('starts unlocked', () => {
    const { result } = renderHook(() => useLockoutCountdown())
    expect(result.current.isLocked).toBe(false)
    expect(result.current.remainingSeconds).toBe(0)
  })

  it('locks for the given seconds and formats the label as m:ss', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const { result } = renderHook(() => useLockoutCountdown())
    act(() => result.current.lock(90))
    expect(result.current.isLocked).toBe(true)
    expect(result.current.remainingLabel).toBe('1:30')
  })

  it('counts down once a second', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const { result } = renderHook(() => useLockoutCountdown())
    act(() => result.current.lock(90))
    act(() => vi.advanceTimersByTime(30_000))
    expect(result.current.remainingLabel).toBe('1:00')
  })

  it('unlocks itself when the time expires', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const { result } = renderHook(() => useLockoutCountdown())
    act(() => result.current.lock(5))
    act(() => vi.advanceTimersByTime(6_000))
    expect(result.current.isLocked).toBe(false)
    expect(result.current.remainingSeconds).toBe(0)
  })
})
