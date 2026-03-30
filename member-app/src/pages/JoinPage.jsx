import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function JoinPage() {
  const [searchParams] = useSearchParams()
  const status = searchParams.get('status')

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  if (status === 'success') {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
        <div className="bg-slate-800 rounded-2xl p-8 max-w-sm w-full text-center">
          <div className="w-16 h-16 bg-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
            <span className="text-2xl">✓</span>
          </div>
          <h1 className="text-white text-xl font-bold mb-3">You're in!</h1>
          <p className="text-slate-400 text-sm leading-relaxed">
            Payment received. Check your email for a link to activate your membership card.
          </p>
        </div>
      </div>
    )
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { data, error: fnError } = await supabase.functions.invoke(
      'create-membership-checkout',
      { body: { name: name.trim(), email: email.trim(), phone: phone.trim() } }
    )
    if (fnError || !data?.url) {
      setError('Could not start payment. Please try again.')
      setLoading(false)
      return
    }
    window.location.href = data.url
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
      <div className="bg-slate-800 rounded-2xl p-8 max-w-sm w-full">
        <h1 className="text-white text-2xl font-bold mb-2 text-center">Join Fairmile</h1>
        <p className="text-slate-400 text-sm text-center mb-8">Annual membership — £50</p>

        {status === 'cancelled' && (
          <div className="bg-slate-700 text-slate-300 rounded-xl px-4 py-3 text-sm text-center mb-6">
            Payment cancelled. Try again below.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-slate-400 text-xs mb-1" htmlFor="join-name">
              Full name
            </label>
            <input
              id="join-name"
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              required
              className="w-full bg-slate-700 border border-slate-600 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-slate-400 text-xs mb-1" htmlFor="join-email">
              Email
            </label>
            <input
              id="join-email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="w-full bg-slate-700 border border-slate-600 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-slate-400 text-xs mb-1" htmlFor="join-phone">
              Phone number
            </label>
            <input
              id="join-phone"
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              required
              className="w-full bg-slate-700 border border-slate-600 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {error && <p className="text-red-400 text-xs">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold py-4 rounded-2xl transition-colors mt-2"
          >
            {loading ? 'Starting payment…' : 'Join for £50'}
          </button>
        </form>
      </div>
    </div>
  )
}
