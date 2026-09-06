import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getPrinterIp, printReceipt, printTabsList, openDrawer } from './starPrinter'

const RECEIPT = {
  orderId: 'some-uuid-ABCD1234',
  total: 12.50,
  paymentMethod: 'cash',
  createdAt: '2026-04-06T14:32:00.000Z',
}

const BRIDGE_URL = 'http://127.0.0.1:3001'

function bodyAsString(call) {
  // Body is a Uint8Array; decode for easier assertions
  return new TextDecoder('latin1').decode(call[1].body)
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ─── getPrinterIp ───────────────────────────────────────────────────────────

describe('getPrinterIp', () => {
  it('returns null when no IP is stored', () => {
    expect(getPrinterIp()).toBeNull()
  })

  it('returns the stored IP', () => {
    localStorage.setItem('printer_ip', '192.168.1.100')
    expect(getPrinterIp()).toBe('192.168.1.100')
  })
})

// ─── printReceipt — simulation mode ─────────────────────────────────────────

describe('printReceipt — simulation mode (no IP)', () => {
  it('resolves without throwing', async () => {
    await expect(printReceipt(RECEIPT)).resolves.toBeUndefined()
  })

  it('logs to console.info', async () => {
    await printReceipt(RECEIPT)
    expect(console.info).toHaveBeenCalledWith(
      expect.stringContaining('[starPrinter]'),
      expect.any(Number),
      expect.any(String)
    )
  })
})

// ─── printReceipt — with IP ──────────────────────────────────────────────────

describe('printReceipt — with IP set', () => {
  beforeEach(() => {
    localStorage.setItem('printer_ip', '192.168.1.100')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
  })

  it('POSTs to the local bridge URL', async () => {
    await printReceipt(RECEIPT)
    expect(fetch).toHaveBeenCalledWith(
      BRIDGE_URL,
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('passes the printer IP via X-Printer-IP header', async () => {
    await printReceipt(RECEIPT)
    const headers = fetch.mock.calls[0][1].headers
    expect(headers['X-Printer-IP']).toBe('192.168.1.100')
  })

  it('sends Content-Type: application/octet-stream', async () => {
    await printReceipt(RECEIPT)
    const headers = fetch.mock.calls[0][1].headers
    expect(headers['Content-Type']).toBe('application/octet-stream')
  })

  it('body is a Uint8Array of raw printer bytes', async () => {
    await printReceipt(RECEIPT)
    expect(fetch.mock.calls[0][1].body).toBeInstanceOf(Uint8Array)
  })

  it('body contains club name', async () => {
    await printReceipt(RECEIPT)
    expect(bodyAsString(fetch.mock.calls[0])).toContain('THE FAIRMILE SPORTS')
  })

  it('body contains formatted total', async () => {
    await printReceipt(RECEIPT)
    expect(bodyAsString(fetch.mock.calls[0])).toContain('12.50')
  })

  it('body contains last 8 chars of orderId uppercased', async () => {
    await printReceipt(RECEIPT)
    expect(bodyAsString(fetch.mock.calls[0])).toContain('ABCD1234')
  })

  it('body contains capitalised payment method', async () => {
    await printReceipt(RECEIPT)
    expect(bodyAsString(fetch.mock.calls[0])).toContain('Cash')
  })

  it('body contains feed-and-partial-cut command (ESC d 3)', async () => {
    await printReceipt(RECEIPT)
    const body = fetch.mock.calls[0][1].body
    // ESC=0x1B, d=0x64, 3=0x03
    const arr = Array.from(body)
    let found = false
    for (let i = 0; i < arr.length - 2; i++) {
      if (arr[i] === 0x1B && arr[i + 1] === 0x64 && arr[i + 2] === 0x03) {
        found = true
        break
      }
    }
    expect(found).toBe(true)
  })

  it('body sets UK international char set (ESC R 3) for £ support', async () => {
    await printReceipt(RECEIPT)
    const arr = Array.from(fetch.mock.calls[0][1].body)
    let found = false
    for (let i = 0; i < arr.length - 2; i++) {
      if (arr[i] === 0x1B && arr[i + 1] === 0x52 && arr[i + 2] === 0x03) {
        found = true
        break
      }
    }
    expect(found).toBe(true)
  })

  it('body contains drawer pulse for cash payment (BEL)', async () => {
    // Star mC-Print3 fires the drawer on a single BEL byte (0x07) using the
    // printer's default pulse timing. No ESC prefix needed on this unit.
    await printReceipt({ ...RECEIPT, paymentMethod: 'cash' })
    const arr = Array.from(fetch.mock.calls[0][1].body)
    expect(arr).toContain(0x07)
  })

  it('body contains drawer pulse for card payment (staff need access to receipt drawer)', async () => {
    await printReceipt({ ...RECEIPT, paymentMethod: 'card' })
    const arr = Array.from(fetch.mock.calls[0][1].body)
    expect(arr).toContain(0x07)
  })

  it('body does NOT contain drawer pulse for tab payment', async () => {
    await printReceipt({ ...RECEIPT, paymentMethod: 'tab' })
    const arr = Array.from(fetch.mock.calls[0][1].body)
    expect(arr).not.toContain(0x07)
  })

  it('throws when bridge returns non-2xx status', async () => {
    fetch.mockResolvedValue({ ok: false, status: 502, text: () => Promise.resolve('') })
    await expect(printReceipt(RECEIPT)).rejects.toThrow('Bridge returned 502')
  })
})

// ─── printTabsList ───────────────────────────────────────────────────────────

const TABS = [
  { id: 'm1', name: 'Alice', tab_balance: 15.50, membership_number: 'M0001' },
  { id: 'm2', name: 'Bob', tab_balance: 8.00, membership_number: 'M0002' },
]

describe('printTabsList — simulation mode (no IP)', () => {
  it('resolves without throwing', async () => {
    await expect(printTabsList(TABS)).resolves.toBeUndefined()
  })

  it('logs to console.info', async () => {
    await printTabsList(TABS)
    expect(console.info).toHaveBeenCalledWith(
      expect.stringContaining('[starPrinter]'),
      expect.any(Number),
      expect.any(String)
    )
  })
})

describe('printTabsList — with IP set', () => {
  beforeEach(() => {
    localStorage.setItem('printer_ip', '192.168.1.100')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
  })

  it('POSTs to the local bridge URL', async () => {
    await printTabsList(TABS)
    expect(fetch).toHaveBeenCalledWith(
      BRIDGE_URL,
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('body contains club name and OPEN TABS heading', async () => {
    await printTabsList(TABS)
    const body = bodyAsString(fetch.mock.calls[0])
    expect(body).toContain('THE FAIRMILE SPORTS')
    expect(body).toContain('OPEN TABS')
  })

  it('body contains each member name, membership number and balance', async () => {
    await printTabsList(TABS)
    const body = bodyAsString(fetch.mock.calls[0])
    expect(body).toContain('Alice (M0001)')
    expect(body).toContain('15.50')
    expect(body).toContain('Bob (M0002)')
    expect(body).toContain('8.00')
  })

  it('body contains grand total with tab count', async () => {
    await printTabsList(TABS)
    const body = bodyAsString(fetch.mock.calls[0])
    expect(body).toContain('TOTAL (2)')
    expect(body).toContain('23.50')
  })

  it('truncates long names so the balance stays on the same line', async () => {
    const longName = 'X'.repeat(80)
    await printTabsList([{ id: 'm1', name: longName, tab_balance: 5, membership_number: 'M0001' }])
    const body = bodyAsString(fetch.mock.calls[0])
    const line = body.split('\n').find(l => l.includes('XXX'))
    expect(line.length).toBeLessThanOrEqual(48)
    expect(line.endsWith('#5.00')).toBe(true) // £ is encoded as byte 0x23 (UK charset)
  })

  it('body contains feed-and-partial-cut command (ESC d 3)', async () => {
    await printTabsList(TABS)
    const arr = Array.from(fetch.mock.calls[0][1].body)
    let found = false
    for (let i = 0; i < arr.length - 2; i++) {
      if (arr[i] === 0x1B && arr[i + 1] === 0x64 && arr[i + 2] === 0x03) {
        found = true
        break
      }
    }
    expect(found).toBe(true)
  })

  it('body does NOT contain drawer pulse (no money changes hands)', async () => {
    await printTabsList(TABS)
    const arr = Array.from(fetch.mock.calls[0][1].body)
    expect(arr).not.toContain(0x07)
  })

  it('throws when bridge returns non-2xx status', async () => {
    fetch.mockResolvedValue({ ok: false, status: 502, text: () => Promise.resolve('') })
    await expect(printTabsList(TABS)).rejects.toThrow('Bridge returned 502')
  })
})

// ─── openDrawer ──────────────────────────────────────────────────────────────

describe('openDrawer — simulation mode (no IP)', () => {
  it('resolves without throwing', async () => {
    await expect(openDrawer()).resolves.toBeUndefined()
  })

  it('logs to console.info', async () => {
    await openDrawer()
    expect(console.info).toHaveBeenCalledWith(
      expect.stringContaining('[starPrinter]'),
      expect.any(Number),
      expect.any(String)
    )
  })
})

describe('openDrawer — with IP set', () => {
  beforeEach(() => {
    localStorage.setItem('printer_ip', '192.168.1.100')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
  })

  it('POSTs to the local bridge URL', async () => {
    await openDrawer()
    expect(fetch).toHaveBeenCalledWith(
      BRIDGE_URL,
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('passes the printer IP via X-Printer-IP header', async () => {
    await openDrawer()
    const headers = fetch.mock.calls[0][1].headers
    expect(headers['X-Printer-IP']).toBe('192.168.1.100')
  })

  it('body contains drawer pulse (BEL)', async () => {
    // Star mC-Print3 fires the drawer on a single BEL byte (0x07).
    await openDrawer()
    const arr = Array.from(fetch.mock.calls[0][1].body)
    expect(arr).toContain(0x07)
  })

  it('body does NOT contain receipt content', async () => {
    await openDrawer()
    expect(bodyAsString(fetch.mock.calls[0])).not.toContain('FAIRMILE')
  })

  it('throws when bridge returns non-2xx status', async () => {
    fetch.mockResolvedValue({ ok: false, status: 502, text: () => Promise.resolve('') })
    await expect(openDrawer()).rejects.toThrow('Bridge returned 502')
  })
})
