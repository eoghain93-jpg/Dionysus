// One-time start-up for the audit layer. Called from main.jsx.
//
// Nothing here is awaited by the app and nothing here can throw into it.

import { supabase } from '../supabase'
import { APP_BUILD } from './build'
import { probeAuditHeaders, auditHeadersEnabled } from './fetch'
import { logEvent, flushEvents } from './log'
import { witnessSeal } from './seal'

let started = false
let lastErrorAt = 0

async function probe() {
  if (auditHeadersEnabled()) return
  let accessToken
  try {
    accessToken = (await supabase.auth.getSession()).data.session?.access_token
  } catch { /* no device session yet */ }
  await probeAuditHeaders({
    url: import.meta.env.VITE_SUPABASE_URL,
    anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    accessToken,
  })
}

// A crash loop must not flood the log: at most one error event every 10 s.
function reportError(message, extra) {
  const now = Date.now()
  if (now - lastErrorAt < 10_000) return
  lastErrorAt = now
  logEvent('app.error', { message: String(message ?? 'unknown').slice(0, 300), ...extra }, { severity: 1 })
}

export function initAudit() {
  if (started || typeof window === 'undefined') return
  started = true
  try {
    probe()
    setInterval(() => { probe(); flushEvents() }, 15_000)
    witnessSeal()
    setInterval(witnessSeal, 15 * 60_000)

    window.addEventListener('online', () => {
      logEvent('connection.restored', {}, { severity: 1 })
      probe()
      flushEvents()
    })
    window.addEventListener('offline', () => logEvent('connection.lost', {}, { severity: 1 }))
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushEvents()
    })
    window.addEventListener('pagehide', () => { flushEvents() })
    window.addEventListener('error', e => reportError(e.message, { source: e.filename, line: e.lineno }))
    window.addEventListener('unhandledrejection', e => reportError(e.reason?.message ?? e.reason, { kind: 'unhandled_rejection' }))

    logEvent('app.started', {
      build: APP_BUILD,
      online: navigator.onLine,
      installed: window.matchMedia?.('(display-mode: standalone)')?.matches ?? null,
      screen: `${window.screen?.width}x${window.screen?.height}`,
    })
  } catch { /* the till runs without the audit layer rather than not at all */ }
}
