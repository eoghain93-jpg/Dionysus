import { getPrinterIp, printReceipt, openDrawer } from './starPrinter'

const RECEIPT = {
  orderId: 'some-uuid-ABCD1234',
  total: 12.50,
  paymentMethod: 'cash',
  createdAt: '2026-04-06T14:32:00.000Z',
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

  it('logs XML to console.info', async () => {
    await printReceipt(RECEIPT)
    expect(console.info).toHaveBeenCalledWith(
      expect.stringContaining('[starPrinter]'),
      expect.stringContaining('THE FAIRMILE SPORTS')
    )
  })
})

// ─── printReceipt — with IP ──────────────────────────────────────────────────

describe('printReceipt — with IP set', () => {
  beforeEach(() => {
    localStorage.setItem('printer_ip', '192.168.1.100')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
  })

  it('POSTs to the correct Star WebPRNT URL', async () => {
    await printReceipt(RECEIPT)
    expect(fetch).toHaveBeenCalledWith(
      'http://192.168.1.100/StarWebPRNT/SendMessage',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('sends Content-Type: application/xml', async () => {
    await printReceipt(RECEIPT)
    const headers = fetch.mock.calls[0][1].headers
    expect(headers['Content-Type']).toBe('application/xml')
  })

  it('XML body contains club name', async () => {
    await printReceipt(RECEIPT)
    const body = fetch.mock.calls[0][1].body
    expect(body).toContain('THE FAIRMILE SPORTS')
  })

  it('XML body contains formatted total', async () => {
    await printReceipt(RECEIPT)
    const body = fetch.mock.calls[0][1].body
    expect(body).toContain('12.50')
  })

  it('XML body contains last 8 chars of orderId uppercased', async () => {
    await printReceipt(RECEIPT)
    const body = fetch.mock.calls[0][1].body
    expect(body).toContain('ABCD1234')
  })

  it('XML body contains capitalised payment method', async () => {
    await printReceipt(RECEIPT)
    const body = fetch.mock.calls[0][1].body
    expect(body).toContain('Cash')
  })

  it('XML body contains drawer pulse for cash payment', async () => {
    await printReceipt({ ...RECEIPT, paymentMethod: 'cash' })
    const body = fetch.mock.calls[0][1].body
    expect(body).toContain('openDrawer')
  })

  it('XML body does NOT contain drawer pulse for card payment', async () => {
    await printReceipt({ ...RECEIPT, paymentMethod: 'card' })
    const body = fetch.mock.calls[0][1].body
    expect(body).not.toContain('openDrawer')
  })

  it('XML body does NOT contain drawer pulse for tab payment', async () => {
    await printReceipt({ ...RECEIPT, paymentMethod: 'tab' })
    const body = fetch.mock.calls[0][1].body
    expect(body).not.toContain('openDrawer')
  })

  it('throws when printer returns non-2xx status', async () => {
    fetch.mockResolvedValue({ ok: false, status: 503 })
    await expect(printReceipt(RECEIPT)).rejects.toThrow('Printer returned 503')
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
      expect.any(String)
    )
  })
})

describe('openDrawer — with IP set', () => {
  beforeEach(() => {
    localStorage.setItem('printer_ip', '192.168.1.100')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
  })

  it('POSTs to the correct URL', async () => {
    await openDrawer()
    expect(fetch).toHaveBeenCalledWith(
      'http://192.168.1.100/StarWebPRNT/SendMessage',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('XML body contains drawer pulse', async () => {
    await openDrawer()
    const body = fetch.mock.calls[0][1].body
    expect(body).toContain('openDrawer')
  })

  it('XML body does NOT contain receipt content', async () => {
    await openDrawer()
    const body = fetch.mock.calls[0][1].body
    expect(body).not.toContain('FAIRMILE')
  })

  it('throws when printer returns non-2xx status', async () => {
    fetch.mockResolvedValue({ ok: false, status: 503 })
    await expect(openDrawer()).rejects.toThrow('Printer returned 503')
  })
})
