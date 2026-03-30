import { useState } from 'react'
import { Delete } from 'lucide-react'

const QUICK_AMOUNTS = [5, 10, 20, 50]
const NUMPAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back']

function formatPence(pence) {
  return `£${(pence / 100).toFixed(2)}`
}

export default function CashPaymentModal({ total, onConfirm, onCancel }) {
  const [digits, setDigits] = useState('')
  const [confirmed, setConfirmed] = useState(false)

  const totalPence = Math.round(total * 100)
  const tenderedPence = digits ? parseInt(digits, 10) * 100 : 0
  const changePence = tenderedPence - totalPence
  const canConfirm = tenderedPence >= totalPence

  function handleKey(key) {
    if (key === 'back') {
      setDigits(d => d.slice(0, -1))
    } else if (key === '.') {
      // ignore — whole pounds only
    } else {
      setDigits(d => d.length < 4 ? d + key : d)
    }
  }

  function handleQuick(pounds) {
    setDigits(String(pounds))
  }

  if (confirmed) {
    return (
      <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-6">
        <div className="bg-slate-800 rounded-2xl p-8 w-full max-w-sm text-center space-y-6">
          <h2 className="text-white text-xl font-bold">Give change</h2>
          <div className="text-green-400 text-6xl font-bold">{formatPence(changePence)}</div>
          <button
            onClick={onConfirm}
            className="w-full bg-emerald-700 hover:bg-emerald-600 text-white font-bold py-4 rounded-2xl text-lg transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-2xl p-6 w-full max-w-sm space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-white text-lg font-bold">Cash Payment</h2>
          <span className="text-slate-400 text-sm">Total: <span className="text-white font-semibold">£{total.toFixed(2)}</span></span>
        </div>

        <div className="grid grid-cols-4 gap-2">
          {QUICK_AMOUNTS.map(amt => (
            <button
              key={amt}
              onClick={() => handleQuick(amt)}
              className="bg-slate-700 hover:bg-slate-600 text-white font-semibold py-3 rounded-xl text-sm transition-colors cursor-pointer"
            >
              £{amt}
            </button>
          ))}
        </div>

        <div className="bg-slate-900 rounded-xl px-4 py-3 text-center">
          <div className="text-white text-3xl font-bold tracking-wide">
            {formatPence(tenderedPence)}
          </div>
          {changePence > 0 && (
            <div className="text-slate-400 text-sm mt-1">
              Change: <span className="text-green-400 font-semibold">{formatPence(changePence)}</span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2">
          {NUMPAD_KEYS.map(key => (
            <button
              key={key}
              onClick={() => handleKey(key)}
              aria-label={key === 'back' ? 'Backspace' : key}
              className="bg-slate-700 hover:bg-slate-600 active:scale-95 text-white font-semibold
                py-4 rounded-xl text-xl transition-all cursor-pointer flex items-center justify-center"
            >
              {key === 'back' ? <Delete size={20} aria-hidden="true" /> : key}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={onCancel}
            className="bg-slate-700 hover:bg-slate-600 text-white font-semibold py-3 rounded-xl transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={() => setConfirmed(true)}
            disabled={!canConfirm}
            className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed
              text-white font-semibold py-3 rounded-xl transition-colors cursor-pointer"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  )
}
