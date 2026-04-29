// Receipt printer client.
//
// This unit's mC-Print3 firmware accepts WebPRNT POSTs but never produces
// paper, so we route through a tiny local bridge (see scripts/print-bridge.mjs)
// that forwards raw bytes to the printer's TCP port 9100. Form-feed (0x0C)
// flushes the print buffer.

const PRINTER_IP_KEY = 'printer_ip'
const BRIDGE_URL = 'http://127.0.0.1:3001'

// ASCII-with-£ encoder. The printer's default code page (CP437/CP858) renders
// £ as byte 0x9C, not the UTF-8 sequence `C2 A3` that TextEncoder emits.
// Anything else outside ASCII falls back to '?'.
function encodePrinterText(str) {
  const out = []
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i)
    if (code === 0x00A3) out.push(0x23)        // £ → byte 0x23 (UK char set, see SET_UK_CHARSET)
    else if (code < 0x80) out.push(code)        // ASCII
    else out.push(0x3F)                         // '?' for anything else
  }
  return Uint8Array.from(out)
}

// Star Line Mode / ESC-POS byte sequences
const ESC = 0x1B
const GS = 0x1D
const LF = 0x0A
const FF = 0x0C
const BEL = 0x07

const INIT = Uint8Array.of(ESC, 0x40)              // ESC @
// ESC R 3 = select UK international char set, which remaps byte 0x23 to £.
// Standard Star approach for printing £ regardless of printer's default code page.
const SET_UK_CHARSET = Uint8Array.of(ESC, 0x52, 0x03)
const ALIGN_LEFT = Uint8Array.of(ESC, 0x61, 0)     // ESC a 0   — ESC/POS
const ALIGN_CENTER = Uint8Array.of(ESC, 0x61, 1)   // ESC a 1   — ESC/POS
const BOLD_ON = Uint8Array.of(ESC, 0x45, 0x01)     // ESC E 1
const BOLD_OFF = Uint8Array.of(ESC, 0x45, 0x00)    // ESC E 0
// ESC d 3 = feed minimum lines and partial cut. Replaces FORM_FEED + PARTIAL_CUT
// which was over-feeding paper.
const FEED_AND_CUT = Uint8Array.of(ESC, 0x64, 0x03)
// Star printers fire drawer 1 on a single BEL byte (0x07) with default pulse
// timing — confirmed working on this mC-Print3 unit. No buffer flush needed.
const DRAWER_KICK = Uint8Array.of(BEL)

export function getPrinterIp() {
  return localStorage.getItem(PRINTER_IP_KEY)
}

function pad(n) {
  return String(n).padStart(2, '0')
}

function formatDate(isoString) {
  const d = new Date(isoString)
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}  ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function concat(...arrays) {
  let total = 0
  for (const a of arrays) total += a.length
  const out = new Uint8Array(total)
  let offset = 0
  for (const a of arrays) {
    out.set(a, offset)
    offset += a.length
  }
  return out
}

function buildReceiptBytes({ orderId, total, paymentMethod, createdAt, includeDrawer }) {
  const dateTime = formatDate(createdAt)
  const receiptRef = String(orderId).slice(-8).toUpperCase()
  const methodLabel = paymentMethod.charAt(0).toUpperCase() + paymentMethod.slice(1)
  const totalStr = `£${Number(total).toFixed(2)}`

  const parts = [
    INIT,
    SET_UK_CHARSET,
    ALIGN_CENTER,
    BOLD_ON,
    encodePrinterText('THE FAIRMILE SPORTS & SOCIAL CLUB\n'),
    BOLD_OFF,
    ALIGN_LEFT,
    encodePrinterText(`\n${dateTime}\n`),
    encodePrinterText(`Receipt #${receiptRef}\n`),
    encodePrinterText(`${methodLabel}\n\n`),
    BOLD_ON,
    encodePrinterText(`TOTAL: ${totalStr}\n`),
    BOLD_OFF,
    ALIGN_CENTER,
    encodePrinterText('\nThank you for your visit\n'),
    FEED_AND_CUT,
  ]
  if (includeDrawer) parts.push(DRAWER_KICK)
  return concat(...parts)
}

function buildDrawerBytes() {
  // Real-time drawer kick bypasses the print buffer, so no form feed needed
  // (and no form feed = no paper movement / cut).
  return DRAWER_KICK
}

async function sendBytes(ip, bytes) {
  // 10-second timeout. This must be LONGER than the bridge's own
  // PRINTER_TIMEOUT_MS (5s) so the bridge has time to either succeed or
  // return a 502 before the browser aborts. Without this safety, a hung
  // bridge or unreachable printer would block the till forever.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10000)
  try {
    const res = await fetch(BRIDGE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Printer-IP': ip,
      },
      body: bytes,
      signal: controller.signal,
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`Bridge returned ${res.status}: ${errText}`)
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function printReceipt({ orderId, total, paymentMethod, createdAt }) {
  const ip = getPrinterIp()
  const bytes = buildReceiptBytes({
    orderId,
    total,
    paymentMethod,
    createdAt,
    includeDrawer: paymentMethod === 'cash',
  })
  if (!ip) {
    console.info('[starPrinter] Simulation mode — no IP set:', bytes.length, 'bytes')
    return
  }
  await sendBytes(ip, bytes)
}

export async function openDrawer() {
  const ip = getPrinterIp()
  const bytes = buildDrawerBytes()
  if (!ip) {
    console.info('[starPrinter] Simulation mode — no IP set:', bytes.length, 'bytes')
    return
  }
  await sendBytes(ip, bytes)
}
