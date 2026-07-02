// Client-generated v4 UUIDs for idempotent writes. The id is minted once on
// the till and travels with the record whether it's saved online or queued
// offline, so a sync replay after a crash is a server-side no-op
// (ON CONFLICT (id) DO NOTHING / upsert ignoreDuplicates).
export function newClientId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID()
  // crypto.randomUUID needs a secure context; the till is served over plain
  // http on the pub LAN, so fall back to a v4 UUID built from
  // getRandomValues (available in non-secure contexts).
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40 // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // variant 10
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
