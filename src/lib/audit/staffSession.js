// The server-side staff session for whoever is signed in at this till.
//
// When a PIN is checked by the database (staff_sign_in) it returns a session
// id and a secret token. The token goes out on every database request as
// x-staff-session (see ./fetch.js) and the server resolves the person from
// it, so "who did this" is decided by the server, not by whatever staff id
// this browser chooses to send.
//
// Held in memory only: a reload signs the person out, exactly as before.
// Deliberately a plain module (no store, no imports) so the fetch wrapper
// can read it without pulling in anything that itself makes requests.

let current = null

/** @param {{ id: string, token: string, staffId: string, trust: 'pin'|'claimed' } | null} session */
export function setStaffSession(session) {
  current = session && session.id && session.token ? { ...session } : null
}

export function clearStaffSession() {
  current = null
}

/** The current session, or null. Never hand the token to anything but ./fetch.js. */
export function getStaffSession() {
  return current
}

export function getStaffToken() {
  return current?.token ?? null
}

export function getStaffSessionId() {
  return current?.id ?? null
}
