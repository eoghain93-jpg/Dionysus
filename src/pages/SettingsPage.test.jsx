import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SettingsPage from './SettingsPage'
import { getPrinterIp, printReceipt, openDrawer } from '../lib/starPrinter'
import { logEvent } from '../lib/audit/log'

vi.mock('../lib/starPrinter', () => ({
  getPrinterIp: vi.fn(() => null),
  printReceipt: vi.fn().mockResolvedValue(undefined),
  openDrawer: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../lib/audit/log', () => ({ logEvent: vi.fn() }))

const eventsOfType = type => logEvent.mock.calls.filter(c => c[0] === type)

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  getPrinterIp.mockReturnValue(null)
  // mockRejectedValue in one test must not leak into the next
  printReceipt.mockResolvedValue(undefined)
  openDrawer.mockResolvedValue(undefined)
})

describe('SettingsPage — IP input', () => {
  it('shows empty input when no IP is stored', () => {
    render(<SettingsPage />)
    expect(screen.getByPlaceholderText(/192\.168/i)).toHaveValue('')
  })

  it('pre-populates input from getPrinterIp()', () => {
    getPrinterIp.mockReturnValue('192.168.1.100')
    render(<SettingsPage />)
    expect(screen.getByPlaceholderText(/192\.168/i)).toHaveValue('192.168.1.100')
  })

  it('Save button writes trimmed IP to localStorage', async () => {
    render(<SettingsPage />)
    await userEvent.type(screen.getByPlaceholderText(/192\.168/i), '10.0.0.1')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(localStorage.getItem('printer_ip')).toBe('10.0.0.1')
  })

  it('shows Saved confirmation after clicking Save', async () => {
    render(<SettingsPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByText(/Saved/)).toBeInTheDocument()
  })

  it('logs settings.printer_ip_changed with the old and new address', async () => {
    localStorage.setItem('printer_ip', '192.168.1.100')
    getPrinterIp.mockReturnValue('192.168.1.100')
    render(<SettingsPage />)
    const input = screen.getByPlaceholderText(/192\.168/i)
    await userEvent.clear(input)
    await userEvent.type(input, ' 10.0.0.1 ')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(logEvent.mock.calls).toEqual([
      ['settings.printer_ip_changed', { from: '192.168.1.100', to: '10.0.0.1' }, { severity: 2 }],
    ])
  })

  it('logs a blanked IP (which silently disables receipts and the drawer)', async () => {
    localStorage.setItem('printer_ip', '192.168.1.100')
    getPrinterIp.mockReturnValue('192.168.1.100')
    render(<SettingsPage />)
    await userEvent.clear(screen.getByPlaceholderText(/192\.168/i))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(localStorage.getItem('printer_ip')).toBe('')
    expect(logEvent.mock.calls).toEqual([
      ['settings.printer_ip_changed', { from: '192.168.1.100', to: '' }, { severity: 2 }],
    ])
  })

  it('logs nothing when Save is pressed without changing the IP', async () => {
    localStorage.setItem('printer_ip', '192.168.1.100')
    getPrinterIp.mockReturnValue('192.168.1.100')
    render(<SettingsPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(logEvent).not.toHaveBeenCalled()
  })
})

describe('SettingsPage — Test Connection', () => {
  it('shows simulation mode message when IP input is empty', async () => {
    render(<SettingsPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Test Connection' }))
    expect(screen.getByText('Simulation mode — no IP configured')).toBeInTheDocument()
    expect(printReceipt).not.toHaveBeenCalled()
  })

  it('calls printReceipt when IP is in the input field', async () => {
    getPrinterIp.mockReturnValue('192.168.1.100')
    render(<SettingsPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Test Connection' }))
    expect(printReceipt).toHaveBeenCalled()
  })

  it('shows success message when printReceipt resolves', async () => {
    getPrinterIp.mockReturnValue('192.168.1.100')
    render(<SettingsPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Test Connection' }))
    expect(await screen.findByText('Test print sent')).toBeInTheDocument()
  })

  it('shows error message when printReceipt throws', async () => {
    getPrinterIp.mockReturnValue('192.168.1.100')
    printReceipt.mockRejectedValue(new Error('refused'))
    render(<SettingsPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Test Connection' }))
    expect(await screen.findByText(/Connection failed/)).toBeInTheDocument()
  })

  it('logs printer.test_printed (the test slip also kicks the drawer)', async () => {
    getPrinterIp.mockReturnValue('192.168.1.100')
    render(<SettingsPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Test Connection' }))
    await screen.findByText('Test print sent')
    expect(logEvent.mock.calls).toEqual([
      ['printer.test_printed', { ok: true }, { severity: 1 }],
    ])
  })

  it('logs the failed test print and why', async () => {
    getPrinterIp.mockReturnValue('192.168.1.100')
    printReceipt.mockRejectedValue(new Error('Bridge returned 502'))
    render(<SettingsPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Test Connection' }))
    await screen.findByText(/Connection failed/)
    expect(logEvent.mock.calls).toEqual([
      ['printer.test_printed', { ok: false }, { severity: 1 }],
      ['receipt.print_failed', { what: 'test', message: 'Bridge returned 502' }, { severity: 1 }],
    ])
  })

  it('logs nothing in simulation mode (nothing was printed)', async () => {
    render(<SettingsPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Test Connection' }))
    expect(screen.getByText('Simulation mode — no IP configured')).toBeInTheDocument()
    expect(logEvent).not.toHaveBeenCalled()
  })
})

describe('SettingsPage — Open Drawer', () => {
  it('calls openDrawer when button is clicked', async () => {
    render(<SettingsPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Open Drawer' }))
    expect(openDrawer).toHaveBeenCalled()
  })

  it('shows success message when openDrawer resolves', async () => {
    render(<SettingsPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Open Drawer' }))
    expect(await screen.findByText('Drawer opened')).toBeInTheDocument()
  })

  it('shows error message when openDrawer throws', async () => {
    openDrawer.mockRejectedValue(new Error('refused'))
    render(<SettingsPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Open Drawer' }))
    expect(await screen.findByText('Failed to open drawer')).toBeInTheDocument()
  })

  it('logs drawer.opened_no_sale at severity 2 once the drawer has opened', async () => {
    getPrinterIp.mockReturnValue('192.168.1.100')
    let release
    openDrawer.mockReturnValue(new Promise(resolve => { release = resolve }))
    render(<SettingsPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Open Drawer' }))
    // not on the button press — only after the kick was sent
    expect(logEvent).not.toHaveBeenCalled()
    release()
    await screen.findByText('Drawer opened')
    expect(logEvent.mock.calls).toEqual([
      ['drawer.opened_no_sale', { source: 'settings' }, { severity: 2 }],
    ])
  })

  it('logs drawer.open_failed (not opened_no_sale) when the kick fails', async () => {
    getPrinterIp.mockReturnValue('192.168.1.100')
    openDrawer.mockRejectedValue(new Error('refused'))
    render(<SettingsPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Open Drawer' }))
    await screen.findByText('Failed to open drawer')
    expect(logEvent.mock.calls).toEqual([
      ['drawer.open_failed', { source: 'settings', message: 'refused' }, { severity: 1 }],
    ])
  })

  it('logs no drawer opening when no printer is configured (the kick is skipped)', async () => {
    render(<SettingsPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Open Drawer' }))
    await screen.findByText('Drawer opened')
    expect(eventsOfType('drawer.opened_no_sale')).toEqual([])
  })
})

describe('SettingsPage — idle lock', () => {
  const control = () => screen.getByLabelText(/lock the till after/i)

  it('shows 5 minutes when nothing has been chosen, without writing the key', () => {
    render(<SettingsPage />)
    expect(control()).toHaveValue('5')
    expect(screen.getByText(/minutes without a touch/i)).toBeInTheDocument()
    expect(localStorage.getItem('idle_lock_minutes')).toBeNull()
    expect(logEvent).not.toHaveBeenCalled()
  })

  it('shows the stored value', () => {
    localStorage.setItem('idle_lock_minutes', '15')
    render(<SettingsPage />)
    expect(control()).toHaveValue('15')
  })

  it('still shows a stored value that is not one of the usual choices', () => {
    localStorage.setItem('idle_lock_minutes', '7')
    render(<SettingsPage />)
    expect(control()).toHaveValue('7')
  })

  it('falls back to 5 when the stored value is not a number', () => {
    localStorage.setItem('idle_lock_minutes', 'soon')
    render(<SettingsPage />)
    expect(control()).toHaveValue('5')
  })

  it('writes the key and logs the change at severity 2', async () => {
    render(<SettingsPage />)
    await userEvent.selectOptions(control(), '10')
    expect(localStorage.getItem('idle_lock_minutes')).toBe('10')
    expect(control()).toHaveValue('10')
    expect(logEvent.mock.calls).toEqual([
      ['settings.idle_lock_changed', { from: 5, to: 10 }, { severity: 2 }],
    ])
  })

  it('0 means never, and `from` is the value that was stored', async () => {
    localStorage.setItem('idle_lock_minutes', '10')
    render(<SettingsPage />)
    await userEvent.selectOptions(control(), '0')
    expect(localStorage.getItem('idle_lock_minutes')).toBe('0')
    expect(screen.getByRole('option', { name: /never/i }).selected).toBe(true)
    expect(logEvent.mock.calls).toEqual([
      ['settings.idle_lock_changed', { from: 10, to: 0 }, { severity: 2 }],
    ])
  })
})
