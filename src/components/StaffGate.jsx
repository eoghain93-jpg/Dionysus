import { useEffect } from 'react'
import { useSessionStore } from '../stores/sessionStore'
import { useTillStore } from '../stores/tillStore'
import { useIdleLock } from '../hooks/useIdleLock'
import { logEvent } from '../lib/audit/log'
import PinLoginScreen from './till/PinLoginScreen'
import LockScreen from './LockScreen'

/**
 * StaffGate — nothing in the app is reachable without a staff member signed
 * in, so everything that happens can be put to a name.
 *
 *   nobody signed in  -> the PIN login and nothing else. The pages are not
 *                        rendered at all: no content, no navigation.
 *   signed in, locked -> the lock screen. The page stays mounted underneath
 *                        (hidden and inert) so the open order and anything
 *                        half-entered survive; nothing can be seen or done
 *                        until a PIN is entered.
 *   signed in         -> the app, with the idle timer running.
 *
 * Sits INSIDE Layout's effects (connectivity listener, offline replay) so
 * those keep running while the gate is closed, and inside DeviceGate.
 */
export default function StaffGate({ children }) {
  const signedIn = useSessionStore(s => !!s.activeStaff)
  const locked = useSessionStore(s => s.locked)

  useIdleLock(signedIn && !locked)

  // Event-wide members pricing must not be inherited by whoever signs in
  // next. TillPage clears it when it sees nobody signed in — but the gate
  // now unmounts TillPage before it can, so the gate does it, with the same
  // log entry: the log saw the mode go on and must see it go off by itself.
  useEffect(() => {
    if (signedIn) return
    const till = useTillStore.getState()
    if (!till.membersOnlyMode) return
    logEvent('pricing.members_only_mode_off', { reason: 'staff_signed_out' }, { severity: 1 })
    till.setMembersOnlyMode(false)
  }, [signedIn])

  if (!signedIn) return <PinLoginScreen />

  return (
    <>
      <div
        className="contents"
        data-testid="staff-gate-content"
        inert={locked}
        aria-hidden={locked ? 'true' : undefined}
        style={locked ? { visibility: 'hidden' } : undefined}
      >
        {children}
      </div>
      {locked && <LockScreen />}
    </>
  )
}
