import { Wifi, WifiOff, RefreshCw } from 'lucide-react'
import { useSyncStore } from '../stores/syncStore'
import { getTillId } from '../lib/till'

export default function StatusBar() {
  const { isOnline, pendingCount } = useSyncStore()
  const syncing = isOnline && pendingCount > 0
  const tillId = getTillId()
  const tillLabel = tillId.toUpperCase().replace('-', ' ')

  return (
    <div
      className={`flex items-center gap-2 px-4 py-1.5 text-xs font-medium transition-colors duration-300
        ${isOnline ? 'bg-emerald-950/80 text-emerald-400' : 'bg-amber-950/80 text-amber-400'}`}
      role="status"
      aria-live="polite"
    >
      {isOnline
        ? syncing
          ? <RefreshCw size={12} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
          : <Wifi size={12} aria-hidden="true" />
        : <WifiOff size={12} aria-hidden="true" />
      }
      <span>
        {isOnline
          ? syncing
            ? `Online — syncing ${pendingCount} transaction${pendingCount > 1 ? 's' : ''}...`
            : 'Online'
          : `Offline${pendingCount > 0 ? ` — ${pendingCount} transaction${pendingCount > 1 ? 's' : ''} pending` : ''}`
        }
      </span>
      <span
        className="ml-auto px-1.5 py-0.5 rounded bg-slate-800/80 text-slate-300 font-mono text-[10px] tracking-wide"
        aria-label={`Active till: ${tillLabel}`}
        data-testid="till-badge"
      >
        {tillLabel}
      </span>
    </div>
  )
}
