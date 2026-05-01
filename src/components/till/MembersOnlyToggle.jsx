import { useState } from 'react'
import { Users } from 'lucide-react'
import { useTillStore } from '../../stores/tillStore'

/**
 * MembersOnlyToggle — global event-mode switch.
 *
 * When OFF: a discrete pill at the top of the till that staff can tap to
 *           enable members-only pricing for the whole session.
 * When ON:  a wide, high-contrast banner that's impossible to miss, with
 *           an inline "End event mode" button.
 *
 * Both transitions go through a confirmation prompt so the mode can't be
 * flipped accidentally during a busy service.
 */
export default function MembersOnlyToggle() {
  const membersOnlyMode = useTillStore(s => s.membersOnlyMode)
  const setMembersOnlyMode = useTillStore(s => s.setMembersOnlyMode)
  const [pendingChange, setPendingChange] = useState(null)

  function requestToggle() {
    setPendingChange(membersOnlyMode ? 'off' : 'on')
  }

  function confirmChange() {
    setMembersOnlyMode(pendingChange === 'on')
    setPendingChange(null)
  }

  function cancelChange() {
    setPendingChange(null)
  }

  if (membersOnlyMode) {
    // Big can't-miss banner mode
    return (
      <>
        <div
          role="status"
          aria-live="polite"
          className="rounded-2xl bg-emerald-600 border-2 border-emerald-400 px-4 py-3
            flex items-center justify-between gap-3 shadow-lg"
        >
          <div className="flex items-center gap-3 min-w-0">
            <Users size={22} className="text-white shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <div className="text-white font-bold text-sm uppercase tracking-wider">
                Members pricing — event mode
              </div>
              <div className="text-emerald-100 text-xs truncate">
                Every sale is using member pricing. Tap to end.
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={requestToggle}
            className="shrink-0 min-h-[44px] px-4 rounded-xl bg-white text-emerald-700
              hover:bg-emerald-50 font-bold text-sm cursor-pointer transition-colors
              focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-emerald-600"
          >
            End event mode
          </button>
        </div>
        {pendingChange && <ConfirmModal pendingChange={pendingChange} onConfirm={confirmChange} onCancel={cancelChange} />}
      </>
    )
  }

  // Discreet pill when off
  return (
    <>
      <button
        type="button"
        onClick={requestToggle}
        className="self-start min-h-[36px] px-3 rounded-lg bg-slate-800 hover:bg-slate-700
          border border-slate-700 text-slate-400 text-xs font-medium cursor-pointer
          transition-colors flex items-center gap-1.5
          focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
      >
        <Users size={14} aria-hidden="true" />
        Start members-only event mode
      </button>
      {pendingChange && <ConfirmModal pendingChange={pendingChange} onConfirm={confirmChange} onCancel={cancelChange} />}
    </>
  )
}

function ConfirmModal({ pendingChange, onConfirm, onCancel }) {
  const turningOn = pendingChange === 'on'
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="members-mode-confirm-title"
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="bg-[#0F172A] border border-slate-700 rounded-2xl w-full max-w-sm p-5 flex flex-col gap-4"
        onClick={e => e.stopPropagation()}
      >
        <h2 id="members-mode-confirm-title" className="text-white text-lg font-bold">
          {turningOn ? 'Start event mode?' : 'End event mode?'}
        </h2>
        <p className="text-slate-300 text-sm">
          {turningOn
            ? 'Every sale will apply members-only pricing without needing to identify each person individually. Use only when the door has confirmed everyone in the building is a member.'
            : 'New sales will return to standard pricing unless an individual member is identified.'}
        </p>
        <div className="flex gap-2 mt-1">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 min-h-[44px] rounded-xl border border-slate-600 text-slate-300
              hover:bg-slate-700 cursor-pointer text-sm font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`flex-1 min-h-[44px] rounded-xl text-white text-sm font-semibold
              cursor-pointer transition-colors ${
              turningOn
                ? 'bg-emerald-600 hover:bg-emerald-500'
                : 'bg-slate-600 hover:bg-slate-500'
            }`}
          >
            {turningOn ? 'Start event mode' : 'End event mode'}
          </button>
        </div>
      </div>
    </div>
  )
}
