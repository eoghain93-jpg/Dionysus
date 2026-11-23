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
          className="rounded-2xl bg-blue-600 border-2 border-blue-300 px-4 py-3
            flex items-center justify-between gap-3 flex-wrap"
        >
          <div className="flex items-center gap-3 min-w-0">
            <Users size={28} className="text-white shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <div className="text-white text-xl leading-tight font-extrabold">
                Members pricing — event mode
              </div>
              <div className="text-white text-[15px] font-semibold">
                Every sale is using member pricing. Tap to end.
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={requestToggle}
            className="ui-btn ui-btn-primary shrink-0 focus-visible:ring-white"
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
        className="min-h-[48px] px-4 rounded-xl bg-transparent hover:bg-slate-800
          border border-slate-700 text-slate-100 text-[15px] font-bold cursor-pointer whitespace-nowrap
          transition-colors flex items-center gap-2
          focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#121314]"
      >
        <Users size={18} aria-hidden="true" />
        Members-only event mode
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
      className="ui-modal-backdrop"
      onClick={onCancel}
    >
      <div
        className="ui-modal"
        onClick={e => e.stopPropagation()}
      >
        <h2 id="members-mode-confirm-title" className="ui-modal-title">
          {turningOn ? 'Start event mode?' : 'End event mode?'}
        </h2>
        <p className="text-slate-300 text-base">
          {turningOn
            ? 'Every sale will apply members-only pricing without needing to identify each person individually. Use only when the door has confirmed everyone in the building is a member.'
            : 'New sales will return to standard pricing unless an individual member is identified.'}
        </p>
        <div className="ui-modal-actions">
          <button
            type="button"
            onClick={onCancel}
            className="ui-btn ui-btn-ghost ui-btn-lg flex-1"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`ui-btn ui-btn-lg flex-1 ${turningOn ? 'ui-btn-accent' : 'ui-btn-primary'}`}
          >
            {turningOn ? 'Start event mode' : 'End event mode'}
          </button>
        </div>
      </div>
    </div>
  )
}
