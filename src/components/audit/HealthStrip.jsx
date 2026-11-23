import { AlertTriangle, CheckCircle, RefreshCw, ShieldCheck } from 'lucide-react'
import { describeProblem } from '../../lib/audit/describe'
import { healthFacts, healthIssues } from './health'

const number = n => Number(n ?? 0).toLocaleString('en-GB')

/**
 * HealthStrip — answers "is it all being recorded, and has anyone tampered
 * with it?" at the top of the Log page.
 *
 * Quiet when all is well (one grey line of facts); a red or amber panel
 * that cannot be missed when something is wrong. "Check now" re-checks the
 * whole log on the spot.
 *
 * Props:
 *   health      audit_health() result, or null while loading / on error
 *   loading     first load in progress
 *   error       message when health could not be loaded
 *   onRetry     reload health
 *   now         current time (ms) — passed in so the strip stays pure
 *   remembered  the newest seal this till has itself been shown, or null
 *   check       { running, result, error } for "Check now"
 *   onCheck     run the check
 *   onShowAlerts  jump to the alerts that need a look
 */
export default function HealthStrip({ health, loading, error, onRetry, now, remembered, check, onCheck, onShowAlerts }) {
  const issues = healthIssues(health, { now, remembered })
  const facts = healthFacts(health, { now })
  const bad = issues.filter(i => i.level === 'bad')
  const warn = issues.filter(i => i.level === 'warn')
  const checkFailed = check?.result && check.result.ok === false
  const alerts = Number(health?.unchecked_alerts ?? 0)

  const tone = bad.length || checkFailed
    ? 'border-red-500 bg-red-950/50'
    : warn.length
      ? 'border-amber-500/70 bg-amber-950/30'
      : 'border-slate-700 bg-[#0F172A]'

  return (
    <section aria-label="Log health" className={`rounded-2xl border p-4 flex flex-col gap-3 ${tone}`}>
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-[12rem]">
          {loading && !health && <p className="text-slate-400 text-sm">Checking the log…</p>}

          {!loading && !health && error && (
            <div role="alert" className="flex flex-col gap-2">
              <p className="text-amber-300 text-sm font-medium">Could not check whether the log is healthy: {error}</p>
              <button
                onClick={onRetry}
                className="self-start min-h-[44px] px-4 rounded-xl border border-slate-600 text-slate-200 hover:bg-slate-700 text-sm font-medium cursor-pointer"
              >
                Try again
              </button>
            </div>
          )}

          {health && bad.length > 0 && (
            <div role="alert" className="flex flex-col gap-1.5">
              <p className="flex items-center gap-2 text-red-300 font-bold text-base">
                <AlertTriangle size={20} aria-hidden="true" className="shrink-0" />
                Something is wrong with the log
              </p>
              <ul className="flex flex-col gap-1">
                {bad.map(i => (
                  <li key={i.text} className="text-red-100 text-sm font-medium break-words">{i.text}</li>
                ))}
              </ul>
            </div>
          )}

          {health && warn.length > 0 && (
            <div className={`flex flex-col gap-1 ${bad.length ? 'mt-2' : ''}`}>
              {bad.length === 0 && (
                <p className="flex items-center gap-2 text-amber-300 font-semibold text-sm">
                  <AlertTriangle size={16} aria-hidden="true" className="shrink-0" />
                  Worth knowing
                </p>
              )}
              <ul className="flex flex-col gap-1">
                {warn.map(i => (
                  <li key={i.text} className="text-amber-100 text-sm break-words">{i.text}</li>
                ))}
              </ul>
            </div>
          )}

          {health && issues.length === 0 && (
            <p className="flex items-center gap-2 text-slate-300 text-sm">
              <ShieldCheck size={16} aria-hidden="true" className="text-emerald-400 shrink-0" />
              Everything is being recorded, and nothing is wrong with the log itself.
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {health && alerts > 0 && (
            <button
              onClick={onShowAlerts}
              className="min-h-[44px] px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-900 text-sm font-bold cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {number(alerts)} {alerts === 1 ? 'alert needs' : 'alerts need'} a look
            </button>
          )}
          <button
            onClick={onCheck}
            disabled={check?.running}
            className="flex items-center gap-2 min-h-[44px] px-4 rounded-xl border border-slate-600 text-slate-200 hover:bg-slate-700 disabled:opacity-60 text-sm font-medium cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <RefreshCw size={16} aria-hidden="true" className={check?.running ? 'animate-spin' : ''} />
            {check?.running ? 'Checking…' : 'Check now'}
          </button>
        </div>
      </div>

      {check?.error && (
        <p role="alert" className="text-amber-300 text-sm">Could not run the check: {check.error}</p>
      )}

      {check?.result && check.result.ok === true && (
        <p role="status" className="flex items-start gap-2 text-emerald-300 text-sm">
          <CheckCircle size={16} aria-hidden="true" className="shrink-0 mt-0.5" />
          <span>
            Checked just now: all {number(check.result.rows_checked)} {Number(check.result.rows_checked) === 1 ? 'entry is' : 'entries are'} intact
            and nothing has been altered{check.result.head?.code ? `. Newest seal ${check.result.head.code}` : ''}.
          </span>
        </p>
      )}

      {checkFailed && (
        <div role="alert" className="flex flex-col gap-1.5 rounded-xl border border-red-500 bg-red-900/40 p-3">
          <p className="flex items-center gap-2 text-red-200 font-bold">
            <AlertTriangle size={18} aria-hidden="true" className="shrink-0" />
            The check FAILED — the log has been altered or damaged
          </p>
          <ul className="list-disc pl-5 flex flex-col gap-1">
            {check.result.problems.length === 0 && (
              <li className="text-red-100 text-sm">The check did not say what was wrong.</li>
            )}
            {check.result.problems.map((p, i) => (
              <li key={i} className="text-red-100 text-sm break-words">{describeProblem(p)}</li>
            ))}
          </ul>
          <p className="text-red-200/80 text-xs">Do not ignore this. Note the time and tell whoever looks after the system.</p>
        </div>
      )}

      {health && (
        <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-400">
          {facts.map(f => (
            <div key={f.label} className="flex gap-1.5 min-w-0">
              <dt className="text-slate-500 shrink-0">{f.label}:</dt>
              <dd className="text-slate-300 break-words min-w-0">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}
