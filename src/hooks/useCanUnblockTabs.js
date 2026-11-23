import { useEffect, useState } from 'react'
import { canUnblockTabs } from '../lib/tabs'

// Whether the signed-in staff member may lift a tab block (Admin and
// Nikki). Only decides what the till shows; the database enforces it.
export function useCanUnblockTabs(staffId) {
  const [allowed, setAllowed] = useState(false)
  useEffect(() => {
    let cancelled = false
    canUnblockTabs(staffId).then(ok => { if (!cancelled) setAllowed(ok) })
    return () => { cancelled = true }
  }, [staffId])
  return allowed
}
