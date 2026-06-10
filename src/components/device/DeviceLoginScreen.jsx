import { useState } from 'react'
import { Monitor, WifiOff } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { setTillId } from '../../lib/till'
import { useSyncStore } from '../../stores/syncStore'

/**
 * DeviceLoginScreen — one-time till device sign-in.
 *
 * Each physical till has a dedicated Supabase auth user (created in the
 * dashboard, mapped to a till_id via the till_devices table). Whoever sets
 * the till up enters the device credential ONCE; the session persists in
 * localStorage and auto-refreshes, so bar staff never see this screen
 * again. Day-to-day staff identity stays on the PIN screen.
 */
export default function DeviceLoginScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const { isOnline } = useSyncStore()

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      if (signInError) {
        setError(signInError.message === 'Invalid login credentials'
          ? 'Wrong email or password for this till.'
          : signInError.message)
        return
      }
      // Learn which till this device is from its till_devices row, so the
      // audit trail (orders, movements, cashback) is stamped correctly
      // without staff having to configure tillId separately.
      const { data: device } = await supabase
        .from('till_devices')
        .select('till_id')
        .eq('auth_user_id', data.user.id)
        .maybeSingle()
      if (device?.till_id) setTillId(device.till_id)
      // DeviceGate's onAuthStateChange listener takes it from here.
    } catch (err) {
      setError(err.message ?? 'Could not sign in. Check the connection and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-900 flex items-center justify-center z-50 p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center">
            <Monitor size={32} className="text-slate-400" aria-hidden="true" />
          </div>
          <h1 className="text-white text-2xl font-bold">Connect This Till</h1>
          <p className="text-slate-400 text-sm">
            One-time setup — enter this till's device login. Staff PINs are
            entered on the next screen, as usual.
          </p>
        </div>

        {!isOnline && (
          <p role="status" className="flex items-center justify-center gap-2 text-amber-300 text-sm text-center bg-amber-400/10 px-4 py-3 rounded-xl">
            <WifiOff size={14} aria-hidden="true" />
            No connection — first-time setup needs the internet.
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <label htmlFor="device-email" className="block text-sm font-medium text-slate-300">
              Device email
            </label>
            <input
              id="device-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white min-h-[44px] focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="device-password" className="block text-sm font-medium text-slate-300">
              Device password
            </label>
            <input
              id="device-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white min-h-[44px] focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {error && (
            <p role="alert" className="text-red-400 text-sm text-center bg-red-400/10 px-4 py-2 rounded-xl">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting || !email || !password}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors cursor-pointer min-h-[48px]"
          >
            {submitting ? 'Connecting…' : 'Connect Till'}
          </button>
        </form>
      </div>
    </div>
  )
}
