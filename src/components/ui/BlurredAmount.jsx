import { useState, useEffect, useRef } from 'react'

// Privacy wrapper for tab amounts visible in customer-facing till positions.
// Renders the formatted amount with a CSS blur applied; tap/click reveals it
// briefly (default 4s) before re-blurring. Settle/adjust modals don't use
// this — staff has already clicked into a context that justifies showing
// the real number.
//
// children   — the formatted amount (or any node) to display
// revealMs   — how long a tap reveals the value (default 4000)
// className  — passthrough for sizing/colour from the parent
//
// Visual: a tight inline-block; blur on the text without affecting layout.

const REVEAL_MS = 4000

export default function BlurredAmount({ children, revealMs = REVEAL_MS, className = '' }) {
  const [revealed, setRevealed] = useState(false)
  const timerRef = useRef(null)

  useEffect(() => () => clearTimeout(timerRef.current), [])

  function reveal(e) {
    // Stop the tap propagating to parent (e.g. a row's "open profile" click)
    // — peeking at the amount shouldn't navigate anywhere.
    e.stopPropagation()
    e.preventDefault()
    setRevealed(true)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setRevealed(false), revealMs)
  }

  return (
    <button
      type="button"
      onClick={reveal}
      aria-label={revealed ? 'Tab amount visible' : 'Tap to reveal tab amount'}
      className={`inline-block tabular-nums select-none transition-[filter] duration-150 cursor-pointer ${revealed ? '' : 'blur-[6px]'} ${className}`}
    >
      {children}
    </button>
  )
}
