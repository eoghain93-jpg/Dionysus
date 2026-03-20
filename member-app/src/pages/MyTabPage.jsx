import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { supabase } from '../lib/supabase'

export default function MyTabPage() {
  const { member } = useAuthStore()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [searchParams] = useSearchParams()
  const paymentStatus = searchParams.get('payment')

  if (!member) return null

  const balance = member.tab_balance ?? 0
  const hasBalance = balance > 0

  async function handlePayTab() {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase.functions.invoke('create-checkout-session')
    if (error || !data?.url) {
      setError('Could not start payment. Please try again.')
      setLoading(false)
      return
    }
    window.location.href = data.url
  }

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-6 gap-6">
      {paymentStatus === 'success' && (
        <div className="bg-green-900 border border-green-700 text-green-300 rounded-xl px-4 py-3 text-sm w-full max-w-sm text-center">
          Payment successful — your tab has been updated.
        </div>
      )}
      {paymentStatus === 'cancelled' && (
        <div className="bg-slate-800 border border-slate-700 text-slate-400 rounded-xl px-4 py-3 text-sm w-full max-w-sm text-center">
          Payment cancelled.
        </div>
      )}

      <div className="bg-slate-800 rounded-3xl p-8 w-full max-w-sm text-center">
        <div className="text-slate-400 text-sm mb-2">Outstanding Tab</div>
        <div className={`text-5xl font-bold mb-8 ${hasBalance ? 'text-amber-400' : 'text-green-400'}`}>
          £{balance.toFixed(2)}
        </div>

        {hasBalance ? (
          <>
            <button
              onClick={handlePayTab}
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold py-4 rounded-2xl transition-colors"
            >
              {loading ? 'Starting payment…' : `Pay £${balance.toFixed(2)}`}
            </button>
            {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
          </>
        ) : (
          <p className="text-slate-400 text-sm">Your tab is all clear!</p>
        )}
      </div>
    </div>
  )
}
