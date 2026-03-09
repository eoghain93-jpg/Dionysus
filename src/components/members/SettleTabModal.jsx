import { useState, useEffect, useRef, useId } from 'react'
import { X, CreditCard, Banknote } from '../../lib/icons'
import { settleTab } from '../../lib/members'

/**
 * Modal to settle a member's tab.
 * Props:
 *   member     — member object with id, name, tab_balance
 *   onClose    — called to close without settling
 *   onSettled  — called after successful settlement
 */
export default function SettleTabModal({ member, onClose, onSettled }) {
  const titleId = useId()
  const overlayRef = useRef(null)
  const firstButtonRef = useRef(null)

  const [settling, setSettling] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    firstButtonRef.current?.focus()
  }, [])

  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  function handleOverlayClick(e) {
    if (e.target === overlayRef.current) onClose()
  }

  async function handleSettle(paymentMethod) {
    setSettling(true)
    setError(null)
    try {
      await settleTab(member.id, member.tab_balance, paymentMethod)
      onSettled()
    } catch (err) {
      setError(err.message ?? 'Failed to settle tab. Please try again.')
      setSettling(false)
    }
  }

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={handleOverlayClick}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-sm bg-[#0F172A] border border-slate-700 rounded-2xl shadow-xl flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-slate-700">
          <h2
            id={titleId}
            className="text-lg font-bold text-white"
            style={{ fontFamily: "'Playfair Display SC', serif" }}
          >
            Settle Tab
          </h2>
          <button
            onClick={onClose}
            aria-label="Close settle tab modal"
            className="text-slate-400 hover:text-white transition-colors cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-5 flex flex-col gap-5">
          <div className="text-center">
            <p className="text-slate-400 text-sm mb-1">{member.name}</p>
            <p className="text-white text-3xl font-bold">
              £{Number(member.tab_balance).toFixed(2)}
            </p>
            <p className="text-slate-400 text-xs mt-1">outstanding tab balance</p>
          </div>

          {error && (
            <p role="alert" className="text-red-400 text-sm bg-red-400/10 px-3 py-2 rounded-lg text-center">
              {error}
            </p>
          )}

          <div className="flex flex-col gap-3">
            <button
              ref={firstButtonRef}
              onClick={() => handleSettle('cash')}
              disabled={settling}
              className="flex items-center justify-center gap-2 min-h-[44px] rounded-xl bg-[#22C55E] hover:bg-green-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-900 font-bold text-sm transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
            >
              <Banknote size={18} aria-hidden="true" />
              Settle by Cash
            </button>
            <button
              onClick={() => handleSettle('card')}
              disabled={settling}
              className="flex items-center justify-center gap-2 min-h-[44px] rounded-xl bg-[#3B82F6] hover:bg-blue-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
            >
              <CreditCard size={18} aria-hidden="true" />
              Settle by Card
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={settling}
              className="min-h-[44px] rounded-xl border border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors cursor-pointer text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617] disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
