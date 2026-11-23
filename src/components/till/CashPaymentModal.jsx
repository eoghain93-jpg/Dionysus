import { useState } from 'react'
import { Delete, ChevronLeft } from 'lucide-react'

const QUICK_AMOUNTS = [5, 10, 20, 50]
const NUMPAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back']

function formatPence(pence) {
  return `£${(pence / 100).toFixed(2)}`
}

export default function CashPaymentModal({ total, onConfirm, onCancel, onDone }) {
  const [digits, setDigits] = useState('')
  const [confirmed, setConfirmed] = useState(false)

  // Snapshot the total at mount time. We do NOT react to total prop changes
  // mid-modal — clearOrder() runs after Confirm fires checkout, which would
  // otherwise drop the live total to £0 and kick us back from the "Give change"
  // screen. The modal is unmounted/remounted on each new sale so the snapshot
  // is always correct for the current sale.
  const [snapshotTotal] = useState(total)
  const totalPence = Math.round(snapshotTotal * 100)
  const tenderedPence = Math.round((parseFloat(digits) || 0) * 100)
  const changePence = tenderedPence - totalPence
  const canConfirm = tenderedPence >= totalPence

  function handleKey(key) {
    if (key === 'back') {
      setDigits(d => d.slice(0, -1))
      return
    }
    if (key === '.') {
      if (digits.includes('.')) return
      setDigits(d => d === '' ? '0.' : d + '.')
      return
    }
    // No more than 2 decimal places
    const dotIdx = digits.indexOf('.')
    if (dotIdx !== -1 && digits.length - dotIdx > 2) return
    // Cap at £999.99
    if (digits.replace('.', '').length >= 5) return
    setDigits(d => d + key)
  }

  function handleQuick(pounds) {
    setDigits(String(pounds))
  }

  function handleConfirm() {
    setConfirmed(true)   // show "give change" screen immediately
    onConfirm()          // and fire the checkout (print + drawer) right now,
                         // so staff can give change while the drawer is open
  }

  if (confirmed) {
    return (
      <div
        role="status"
        className="fixed inset-0 z-50 bg-emerald-950 flex flex-col items-center justify-center gap-3 p-6 text-center"
      >
        <h2 className="text-emerald-300 text-2xl font-bold">Give change</h2>
        <div className="text-white text-[112px] md:text-[200px] leading-none font-extrabold tracking-tight">
          {formatPence(changePence)}
        </div>
        <p className="text-slate-100 text-lg mt-2">The drawer is open and the receipt is printing</p>
        <button
          onClick={onDone ?? onCancel}
          className="mt-8 w-full max-w-sm min-h-[80px] rounded-2xl bg-slate-100 hover:bg-white text-[#121314]
            text-[22px] font-extrabold transition-colors cursor-pointer"
        >
          Done
        </button>
      </div>
    )
  }

  const short = tenderedPence > 0 && !canConfirm

  return (
    <div className="fixed inset-0 z-50 bg-[#121314] flex flex-col md:flex-row overflow-auto">
      <section className="md:w-[40%] md:max-w-[520px] shrink-0 bg-slate-900 border-b md:border-b-0 md:border-r border-slate-800
        px-6 md:px-10 py-6 md:py-8 flex md:flex-col items-center md:items-start justify-between md:justify-start gap-4">
        <button
          onClick={onCancel}
          className="min-h-[48px] px-4 rounded-xl border border-slate-700 text-slate-100 text-[15px] font-bold
            hover:bg-slate-800 transition-colors cursor-pointer flex items-center gap-2"
        >
          <ChevronLeft size={20} aria-hidden="true" />
          Cancel
        </button>
        <div className="md:mt-12 text-right md:text-left">
          <h2 className="text-emerald-300 text-lg font-bold">Cash payment</h2>
          <div className="text-slate-400 text-lg font-semibold md:mt-2">To pay</div>
          <div className="text-white text-5xl md:text-[96px] leading-none font-extrabold tracking-tight md:mt-1">
            £{snapshotTotal.toFixed(2)}
          </div>
        </div>
      </section>

      <section className="flex-1 min-w-0 px-6 md:px-12 py-6 md:py-8 flex flex-col gap-4 max-w-3xl">
        <div className="grid grid-cols-5 gap-2.5">
          <button
            onClick={() => setDigits(snapshotTotal.toFixed(2))}
            className="min-h-[68px] rounded-2xl bg-emerald-700 hover:bg-emerald-600 text-white text-xl font-extrabold
              transition-colors cursor-pointer"
          >
            Exact
          </button>
          {QUICK_AMOUNTS.map(amt => {
            const quickChange = amt * 100 - totalPence
            return (
              <button
                key={amt}
                onClick={() => handleQuick(amt)}
                aria-label={`£${amt}`}
                className={`min-h-[68px] rounded-2xl border-[1.5px] text-white transition-colors cursor-pointer
                  flex flex-col items-center justify-center gap-0.5
                  ${tenderedPence === amt * 100 ? 'bg-emerald-950 border-emerald-300' : 'border-slate-700 hover:bg-slate-800'}`}
              >
                <span className="text-xl font-extrabold">£{amt}</span>
                {quickChange >= 0 && (
                  <span className="text-emerald-300 text-[13px] font-semibold">change {formatPence(quickChange)}</span>
                )}
              </button>
            )
          })}
        </div>

        <div className="rounded-2xl bg-slate-800 px-5 py-4 flex items-end justify-between gap-4">
          <div>
            <div className="text-slate-400 text-[15px] font-semibold">Customer gave</div>
            <div className="text-white text-5xl font-extrabold leading-tight">{formatPence(tenderedPence)}</div>
          </div>
          {changePence >= 0 && tenderedPence > 0 && (
            <div className="text-right">
              <div className="text-slate-400 text-[15px] font-semibold">Change</div>
              <div className="text-emerald-300 text-5xl font-extrabold leading-tight">{formatPence(changePence)}</div>
            </div>
          )}
          {short && (
            <div className="text-right">
              <div className="text-slate-400 text-[15px] font-semibold">Still short</div>
              <div className="text-amber-300 text-5xl font-extrabold leading-tight">{formatPence(-changePence)}</div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2.5">
          {NUMPAD_KEYS.map(key => (
            <button
              key={key}
              onClick={() => handleKey(key)}
              aria-label={key === 'back' ? 'Backspace' : key}
              className="min-h-[72px] rounded-2xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-white
                text-3xl font-bold transition-all cursor-pointer flex items-center justify-center"
            >
              {key === 'back' ? <Delete size={26} aria-hidden="true" /> : key}
            </button>
          ))}
        </div>

        <button
          onClick={handleConfirm}
          disabled={!canConfirm}
          className="min-h-[80px] rounded-2xl bg-emerald-700 hover:bg-emerald-600 disabled:opacity-35
            disabled:cursor-not-allowed text-white text-[22px] font-extrabold transition-colors cursor-pointer"
        >
          Confirm
        </button>
      </section>
    </div>
  )
}
