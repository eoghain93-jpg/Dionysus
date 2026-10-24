import { useEffect, useRef } from 'react'

// Staff Easter egg: a black-and-white takeover for our resident Newcastle fan.
// Purely decorative — no data, no side effects beyond the overlay itself.

const DURATION_MS = 5500
const STRIPES = 10
const CONFETTI = 48
const MAGPIES = [
  { top: '10%', delay: 0.3, scale: 2 },
  { top: '70%', delay: 0.9, scale: 1.4 },
  { top: '30%', delay: 1.6, scale: 1.7 },
]

// Deterministic scatter so renders stay pure (no Math.random in render).
function scatter(i, salt) {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453
  return x - Math.floor(x)
}

function Magpie({ scale }) {
  return (
    // White outline keeps the bird visible when it crosses a black stripe
    <svg
      viewBox="0 0 120 60"
      stroke="#fff"
      strokeWidth="2.5"
      strokeLinejoin="round"
      style={{ overflow: 'visible' }}
      width={120 * scale}
      height={60 * scale}
      aria-hidden="true"
    >
      {/* Tail */}
      <path d="M8 34 L44 30 L44 38 Z" fill="#000" />
      {/* Body */}
      <ellipse cx="62" cy="34" rx="22" ry="11" fill="#000" />
      {/* White belly */}
      <ellipse cx="66" cy="38" rx="13" ry="6" fill="#fff" stroke="#000" strokeWidth="1.5" />
      {/* Head + beak */}
      <circle cx="86" cy="28" r="8" fill="#000" />
      <path d="M93 27 L104 29 L93 31 Z" fill="#000" />
      <circle cx="88" cy="26" r="1.6" fill="#fff" stroke="none" />
      {/* Wing — flaps via CSS */}
      <g className="davey-wing">
        <path d="M50 30 Q62 2 80 12 Q70 22 64 32 Z" fill="#000" />
        <path d="M58 22 Q64 12 72 14 Q66 20 62 26 Z" fill="#fff" stroke="none" />
      </g>
    </svg>
  )
}

export default function DaveyMode({ onClose }) {
  const closeRef = useRef(onClose)

  useEffect(() => {
    closeRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const timer = setTimeout(() => closeRef.current(), DURATION_MS)
    function handleKey(e) {
      if (e.key === 'Escape') closeRef.current()
    }
    document.addEventListener('keydown', handleKey)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('keydown', handleKey)
    }
  }, [])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Davey mode"
      onClick={() => onClose()}
      className="davey-overlay fixed inset-0 z-[100] overflow-hidden cursor-pointer select-none"
    >
      {/* Stripes */}
      <div className="absolute inset-0 flex" aria-hidden="true">
        {Array.from({ length: STRIPES }, (_, i) => (
          <div
            key={i}
            className="davey-stripe flex-1 h-full"
            style={{
              background: i % 2 === 0 ? '#000' : '#fff',
              animationDelay: `${i * 0.06}s`,
            }}
          />
        ))}
      </div>

      {/* Magpies */}
      {MAGPIES.map((m, i) => (
        <div
          key={i}
          className="davey-magpie absolute left-0"
          style={{ top: m.top, animationDelay: `${m.delay}s` }}
          aria-hidden="true"
        >
          <Magpie scale={m.scale} />
        </div>
      ))}

      {/* Confetti */}
      {Array.from({ length: CONFETTI }, (_, i) => (
        <span
          key={i}
          className="davey-confetti absolute top-0 block"
          style={{
            left: `${scatter(i, 1) * 100}%`,
            width: `${6 + scatter(i, 2) * 8}px`,
            height: `${10 + scatter(i, 3) * 10}px`,
            background: i % 2 === 0 ? '#000' : '#fff',
            outline: '1px solid #000',
            animationDelay: `${0.6 + scatter(i, 4) * 2}s`,
            animationDuration: `${2.2 + scatter(i, 5) * 1.6}s`,
          }}
          aria-hidden="true"
        />
      ))}

      {/* Headline */}
      <div className="absolute inset-0 flex items-center justify-center p-4 pointer-events-none">
        <div className="davey-card bg-black text-white border-4 border-white rounded-2xl px-8 py-6 text-center shadow-2xl">
          <p className="text-xs sm:text-sm font-bold tracking-[0.4em] uppercase">Davey Mode</p>
          <p className="davey-shout font-display text-4xl sm:text-6xl font-black mt-2 leading-tight">
            Howay the lads!
          </p>
          <p className="mt-3 text-sm text-slate-300">Tap anywhere to get back to work</p>
        </div>
      </div>
    </div>
  )
}
