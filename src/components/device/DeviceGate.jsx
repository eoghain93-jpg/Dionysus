import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import DeviceLoginScreen from './DeviceLoginScreen'

/**
 * DeviceGate — the till runs as an authenticated device, not as anon.
 *
 * Wraps the whole app: until a Supabase auth session exists, only the
 * one-time DeviceLoginScreen renders. The session persists in localStorage
 * (supabase-js default) and auto-refreshes, so:
 *   - normal day: session loads from cache instantly, gate is invisible
 *   - offline start: the CACHED session still loads (getSession reads
 *     localStorage), the offline order queue keeps working, and the token
 *     refreshes itself when connectivity returns
 *   - first ever launch: whoever installs the till signs in once
 */
export default function DeviceGate({ children }) {
  // undefined = still loading from storage, null = no session
  const [session, setSession] = useState(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, newSession) => setSession(newSession)
    )
    return () => subscription.unsubscribe()
  }, [])

  if (session === undefined) {
    return <div className="fixed inset-0 bg-slate-900" aria-busy="true" />
  }

  if (session === null) {
    return <DeviceLoginScreen />
  }

  return children
}
