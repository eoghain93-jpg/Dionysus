import { useState, useEffect } from 'react'
import { useAuthStore } from '../stores/authStore'
import { supabase } from '../lib/supabase'

export default function HistoryPage() {
  const { member } = useAuthStore()
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!member) return
    async function load() {
      const [ordersResult, paymentsResult] = await Promise.all([
        supabase.from('orders')
          .select('id, total_amount, created_at, payment_method')
          .eq('member_id', member.id)
          .order('created_at', { ascending: false })
          .limit(50),
        supabase.from('tab_payments')
          .select('id, amount, created_at')
          .eq('member_id', member.id)
          .order('created_at', { ascending: false })
          .limit(50),
      ])

      const purchases = (ordersResult.data ?? []).map(o => ({
        id: o.id,
        type: 'purchase',
        label: o.payment_method === 'tab' ? 'Tab purchase' : 'Purchase',
        amount: -o.total_amount,
        date: o.created_at,
      }))

      const payments = (paymentsResult.data ?? []).map(p => ({
        id: p.id,
        type: 'payment',
        label: 'Tab payment',
        amount: p.amount,
        date: p.created_at,
      }))

      const combined = [...purchases, ...payments].sort(
        (a, b) => new Date(b.date) - new Date(a.date)
      )
      setEntries(combined)
      setLoading(false)
    }
    load()
  }, [member])

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <p className="text-slate-400">Loading history…</p>
      </div>
    )
  }

  return (
    <div className="bg-slate-900 min-h-screen p-4">
      <h1 className="text-white text-xl font-bold mb-4 pt-4">History</h1>
      {entries.length === 0 ? (
        <p className="text-slate-500 text-sm text-center mt-12">No transactions yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {entries.map(entry => (
            <div key={entry.id} className="bg-slate-800 rounded-xl px-4 py-3 flex items-center justify-between">
              <div>
                <div className="text-white text-sm">{entry.label}</div>
                <div className="text-slate-500 text-xs">
                  {new Date(entry.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                </div>
              </div>
              <div className={`font-semibold text-sm ${entry.amount >= 0 ? 'text-green-400' : 'text-slate-300'}`}>
                {entry.amount >= 0 ? '+' : '−'}£{Math.abs(entry.amount).toFixed(2)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
