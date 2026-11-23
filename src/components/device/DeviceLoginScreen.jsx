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
    <div className="fixed inset-0 bg-[#121314] flex items-center justify-center z-50 p-4 overflow-auto">
      <div className="ui-card w-full max-w-md p-6 md:p-8 flex flex-col gap-6 my-auto">
        <div className="flex flex-col gap-2">
          <Monitor size={32} className="text-slate-400" aria-hidden="true" />
          <h1 className="text-white text-3xl font-extrabold tracking-tight leading-tight">Connect This Till</h1>
          <p className="ui-subtitle">
            One-time setup — enter this till's device login. Staff PINs are
            entered on the next screen, as usual.
          </p>
        </div>

        {!isOnline && (
          <p role="status" className="ui-banner ui-banner-warn flex-nowrap">
            <WifiOff size={18} className="shrink-0" aria-hidden="true" />
            No connection — first-time setup needs the internet.
          </p>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label htmlFor="device-email" className="ui-label">
              Device email
            </label>
            <input
              id="device-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="ui-input"
            />
          </div>
          <div>
            <label htmlFor="device-password" className="ui-label">
              Device password
            </label>
            <input
              id="device-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className="ui-input"
            />
          </div>

          {error && (
            <p role="alert" className="ui-banner ui-banner-bad">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting || !email || !password}
            className="ui-btn ui-btn-primary ui-btn-lg w-full mt-1"
          >
            {submitting ? 'Connecting…' : 'Connect Till'}
          </button>
        </form>
      </div>
    </div>
  )
}
