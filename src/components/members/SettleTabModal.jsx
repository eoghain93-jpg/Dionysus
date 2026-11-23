import { useState, useEffect, useRef, useId } from 'react'
import { X, CreditCard, Banknote, ChevronRight } from '../../lib/icons'
import { settleTab } from '../../lib/members'
import { printReceipt } from '../../lib/starPrinter'
import { useToastStore } from '../../hooks/useToast'
import CashPaymentModal from '../till/CashPaymentModal'

/**
 * Modal to settle a member's tab.
 *
 * Two-step flow: staff must first make an explicit choice between a PART
 * payment and paying the FULL balance. The part-payment amount field starts
 * empty — it is never pre-filled with the full balance, so a mis-tap can no
 * longer wipe a whole tab when the customer only handed over part of it.
 * Part payment is listed first and nothing is auto-focused, so the
 * higher-stakes full settle always takes a deliberate read-and-tap.
 *
 * Props:
 *   member     — member object with id, name, tab_balance
 *   onClose    — called to close without settling
 *   onSettled  — called with the amount paid after successful settlement
 */
export default function SettleTabModal({ member, onClose, onSettled }) {
  const titleId = useId()
  const hintId = useId()
  const errorId = useId()
  const overlayRef = useRef(null)
  const dialogRef = useRef(null)
  const amountInputRef = useRef(null)

  const balance = Number(member.tab_balance)

  const [step, setStep] = useState('choice') // 'choice' | 'pay'
  const [mode, setMode] = useState(null)     // 'full' | 'partial'
  const [amount, setAmount] = useState('')
  const [settling, setSettling] = useState(false)
  const [error, setError] = useState(null)
  // Amount snapshotted at the moment the cash flow opens. Both the cash
  // modal's displayed total and the eventual settle use this one value —
  // never live state, which Back (or a hardware keyboard reaching the
  // still-mounted input) could change underneath the open cash modal.
  const [cashAmount, setCashAmount] = useState(null)

  // While a settle is mid-flight (or the cash drawer flow is open) the modal
  // must not be dismissable: unmounting would swallow a late failure and
  // staff would walk away believing the tab was reduced.
  const lockedClosed = settling || cashAmount !== null

  useEffect(() => {
    dialogRef.current?.focus()
  }, [])

  useEffect(() => {
    if (step === 'pay' && mode === 'partial') amountInputRef.current?.focus()
  }, [step, mode])

  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape' && !lockedClosed) onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose, lockedClosed])

  function handleOverlayClick(e) {
    if (e.target === overlayRef.current && !lockedClosed) onClose()
  }

  function choose(nextMode) {
    setMode(nextMode)
    setAmount('')
    setError(null)
    setCashAmount(null)
    setStep('pay')
  }

  function goBack() {
    setStep('choice')
    setMode(null)
    setAmount('')
    setError(null)
    setCashAmount(null)
  }

  // The amount actually charged, in whole pence terms. Full mode reads the
  // member record, never an editable field; partial mode rounds the typed
  // value to 2dp so the recorded order, the tab delta and the validated
  // figure can never disagree by sub-penny amounts.
  function effectiveAmount() {
    if (mode === 'full') return balance
    const pence = Math.round(parseFloat(amount) * 100)
    return Number.isFinite(pence) ? pence / 100 : NaN
  }

  async function handleSettle(paymentMethod) {
    const val = effectiveAmount()
    if (mode === 'partial') {
      if (!val || val < 0.01) { setError('Enter a valid amount'); return }
      if (val > balance) { setError('Amount exceeds tab balance'); return }
    }

    if (paymentMethod === 'cash') {
      setError(null)
      setCashAmount(val)
      return
    }

    await doSettle(val, paymentMethod)
  }

  async function doSettle(val, paymentMethod) {
    setSettling(true)
    setError(null)
    try {
      await settleTab(member.id, val, paymentMethod)
    } catch (err) {
      setError(err.message ?? 'Failed to settle tab. Please try again.')
      setSettling(false)
      setCashAmount(null)
      return
    }

    // Print + drawer kick mirror the till checkout flow (TillPage handleCheckout).
    // Wrapped so a printer/bridge failure can't block the settle from completing.
    try {
      await printReceipt({
        orderId: `TAB-${Date.now()}`,
        total: val,
        paymentMethod,
        createdAt: new Date().toISOString(),
      })
    } catch (err) {
      console.error('Print failed:', err)
      useToastStore.getState().addToast('Print failed — check printer connection', 'error')
    }

    // Pass the amount up so parents can distinguish a partial settle from a
    // full one (TabsPage keeps the member listed with a reduced balance).
    onSettled(val)
  }

  return (
    <div
      ref={overlayRef}
      className="ui-modal-backdrop"
      onClick={handleOverlayClick}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="ui-modal focus:outline-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <h2
            id={titleId}
            className="ui-modal-title"
          >
            Settle Tab
          </h2>
          <button
            onClick={() => { if (!lockedClosed) onClose() }}
            aria-label="Close settle tab modal"
            className="ui-btn ui-btn-ghost ui-btn-icon shrink-0"
          >
            <X size={22} aria-hidden="true" />
          </button>
        </div>

        {/* Balance */}
        <div className="rounded-2xl bg-slate-800 px-5 py-4">
          <p className="text-slate-100 text-lg font-bold">{member.name}</p>
          <p className="text-white text-5xl leading-tight font-extrabold tracking-tight">
            £{balance.toFixed(2)}
          </p>
          <p className="text-slate-400 text-[15px] font-semibold">outstanding tab balance</p>
        </div>

        {step === 'choice' && (
          <div className="flex flex-col gap-3">
            <p className="text-white text-lg font-bold">
              How much is {member.name.split(' ')[0]} paying?
            </p>
            <button
              onClick={() => choose('partial')}
              className="flex items-center justify-between gap-3 min-h-[76px] px-5 rounded-2xl bg-slate-800 border-[1.5px] border-slate-700
                hover:bg-slate-700 text-white text-left transition-colors cursor-pointer
                focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
            >
              <span className="flex flex-col items-start">
                <span className="text-lg font-extrabold">Part payment</span>
                <span className="text-slate-400 text-[15px]">enter the amount handed over</span>
              </span>
              <ChevronRight size={22} className="shrink-0" aria-hidden="true" />
            </button>
            <button
              onClick={() => choose('full')}
              className="flex items-center justify-between gap-3 min-h-[76px] px-5 rounded-2xl bg-slate-800 border-[1.5px] border-amber-800
                hover:bg-slate-700 text-white text-left transition-colors cursor-pointer
                focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
            >
              <span className="flex flex-col items-start">
                <span className="text-lg font-extrabold">Full balance</span>
                <span className="text-slate-400 text-[15px]">clears the whole tab</span>
              </span>
              <span className="flex items-center gap-1.5 text-xl font-extrabold text-amber-300 shrink-0">
                £{balance.toFixed(2)}
                <ChevronRight size={22} aria-hidden="true" />
              </span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="ui-btn ui-btn-ghost ui-btn-lg"
            >
              Cancel
            </button>
          </div>
        )}

        {step === 'pay' && (
          <>
            {mode === 'full' ? (
              <div className="rounded-2xl border-[1.5px] border-amber-800 px-5 py-3">
                <p className="text-amber-300 text-[15px] font-bold">Paying full balance</p>
                <p className="text-white text-3xl font-extrabold">£{balance.toFixed(2)}</p>
              </div>
            ) : (
              <div>
                <label htmlFor="settle-amount" className="ui-label">
                  Amount handed over (£)
                </label>
                <input
                  ref={amountInputRef}
                  id="settle-amount"
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  step="0.01"
                  max={balance}
                  placeholder="0.00"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  aria-invalid={error ? 'true' : undefined}
                  aria-describedby={error ? `${hintId} ${errorId}` : hintId}
                  className="ui-input min-h-[72px] text-center text-4xl font-extrabold"
                />
                <p id={hintId} className="ui-help mt-1.5 text-center">of £{balance.toFixed(2)} outstanding</p>
              </div>
            )}

            {error && (
              <p id={errorId} role="alert" className="ui-banner ui-banner-bad">
                {error}
              </p>
            )}

            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => handleSettle('cash')}
                  disabled={settling}
                  className="ui-btn ui-btn-pay ui-btn-lg min-h-[72px] px-3"
                >
                  <Banknote size={22} aria-hidden="true" />
                  Settle by Cash
                </button>
                <button
                  onClick={() => handleSettle('card')}
                  disabled={settling}
                  className="ui-btn ui-btn-primary ui-btn-lg min-h-[72px] px-3"
                >
                  <CreditCard size={22} aria-hidden="true" />
                  Settle by Card
                </button>
              </div>
              <button
                type="button"
                onClick={goBack}
                disabled={settling}
                className="ui-btn ui-btn-ghost ui-btn-lg"
              >
                Back
              </button>
            </div>
          </>
        )}
      </div>
      {cashAmount !== null && (
        <CashPaymentModal
          total={cashAmount}
          onConfirm={() => doSettle(cashAmount, 'cash')}
          onCancel={() => setCashAmount(null)}
          onDone={() => setCashAmount(null)}
        />
      )}
    </div>
  )
}
