import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SettingsPage from './SettingsPage'
import { getPrinterIp, printReceipt, openDrawer } from '../lib/starPrinter'

vi.mock('../lib/starPrinter', () => ({
  getPrinterIp: vi.fn(() => null),
  printReceipt: vi.fn().mockResolvedValue(undefined),
  openDrawer: vi.fn().mockResolvedValue(undefined),
}))

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  getPrinterIp.mockReturnValue(null)
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
})
