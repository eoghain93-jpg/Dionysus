// What this till last learned about reaching the server.
//
// navigator.onLine only says whether the till has a network link. The usual
// pub outage is the broadband line failing while the Wi-Fi stays up: the
// browser still says "online" and nothing can be checked. So the till
// remembers the evidence instead:
//
//   markUnreachable()  a PIN check (or a sign-out) got no answer
//   markReached()      the server answered something
//
// While serverUnreachable() is true the till behaves as it does offline: it
// does not auto-lock, the lock screen offers the recorded carry-on at once,
// and Sign out is refused — none of them can leave a till nobody can use.
// The first answer from the server clears it, so all three come back by
// themselves.
//
// Deliberately a plain module (no store, no imports): the fetch wrapper
// reports to it on every database write.

let unreachable = false
let answers = 0

/** The server answered. */
export function markReached() {
  unreachable = false
  answers += 1
}

/** Something that needed the server got no answer. */
export function markUnreachable() {
  unreachable = true
}

/** True from a failed attempt until the next answer. */
export function serverUnreachable() {
  return unreachable
}

/**
 * How many answers have been noted. Compare before and after an attempt to
 * learn whether the server answered during it.
 */
export function answersSeen() {
  return answers
}
