import { AlertTriangle } from 'lucide-react'
import { DISPUTED_MEANING, disputedSealLines } from './health'

/**
 * DisputedSeals — this till's own evidence that the log's history changed
 * underneath it: seals it was once shown that the database later no longer
 * had (disputedSeals() in lib/audit/seal.js).
 *
 * Shown for as long as the till keeps them (until its storage is cleared),
 * and needing nothing from the server — so it still shows when the log
 * itself cannot be opened, which is exactly when it matters most (a
 * database put back to before the log existed looks like "not set up yet").
 * Renders nothing when the till holds no such seal.
 *
 * Props: disputed  [{ id, hash, code, at, noticed_at }]
 */
export default function DisputedSeals({ disputed }) {
  const evidence = disputedSealLines(disputed)
  if (evidence.length === 0) return null
  return (
    <div role="group" aria-label="What this till remembers" className="flex flex-col gap-1.5 rounded-xl border border-amber-500/70 bg-amber-950/40 p-3">
      <p className="flex items-center gap-2 text-amber-200 font-bold text-sm">
        <AlertTriangle size={16} aria-hidden="true" className="shrink-0" />
        This till’s own evidence that the log’s history changed
      </p>
      <p className="text-amber-100 text-sm break-words">{DISPUTED_MEANING}</p>
      <ul className="list-disc pl-5 flex flex-col gap-1">
        {evidence.map(e => (
          <li key={e.key} className="text-amber-100 text-sm break-words">{e.text}</li>
        ))}
      </ul>
      <p className="text-amber-200/80 text-xs">
        Kept on this till until its storage is cleared. If nobody restored the database around then, tell whoever looks after the system.
      </p>
    </div>
  )
}
