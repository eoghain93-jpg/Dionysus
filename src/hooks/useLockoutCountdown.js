import { useState, useEffect, useCallback } from 'react'

// Countdown for PIN lockout (verify-pin returns reason:'locked' with
// retryAfterSeconds). Ticks down once a second while locked and clears
// itself at zero so the numpad re-enables without a refresh.
export function useLockoutCountdown() {
  const [remainingSeconds, setRemainingSeconds] = useState(0)
  const isLocked = remainingSeconds > 0

  useEffect(() => {
    if (!isLocked) return
    const id = setInterval(() => {
      setRemainingSeconds(s => (s <= 1 ? 0 : s - 1))
    }, 1000)
    return () => clearInterval(id)
  }, [isLocked])

  const lock = useCallback((retryAfterSeconds) => {
    setRemainingSeconds(Math.max(0, Math.ceil(retryAfterSeconds ?? 0)))
  }, [])

  const minutes = Math.floor(remainingSeconds / 60)
  const seconds = remainingSeconds % 60

  return {
    isLocked,
    remainingSeconds,
    remainingLabel: `${minutes}:${String(seconds).padStart(2, '0')}`,
    lock,
  }
}
