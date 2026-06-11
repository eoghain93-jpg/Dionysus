import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import SettleTabModal from './SettleTabModal'

// ── Mocks ──────────────────────────────────────────────────────────────────────
const { mockSettleTab, mockPrintReceipt, mockAddToast } = vi.hoisted(() => ({
  mockSettleTab: vi.fn(),
  mockPrintReceipt: vi.fn(),
  mockAddToast: vi.fn(),
}))

vi.mock('../../lib/members', () => ({
  settleTab: mockSettleTab,
}))

vi.mock('../../lib/starPrinter', () => ({
  printReceipt: mockPrintReceipt,
}))

vi.mock('../../hooks/useToast', () => ({
  useToastStore: {
    getState: () => ({ addToast: mockAddToast }),
  },
}))

// Stub the cash tender/change flow — its own behaviour is covered by
// CashPaymentModal.test.jsx. Here we only care what total it receives and
// that confirming fires the settle.
vi.mock('../till/CashPaymentModal', () => ({
  default: ({ total, onConfirm, onCancel }) => (
    <div data-testid="cash-modal">
      <span data-testid="cash-modal-total">{total.toFixed(2)}</span>
      <button onClick={onConfirm}>Mock Confirm Cash</button>
      <button onClick={onCancel}>Mock Cancel Cash</button>
    </div>
  ),
}))

const MEMBER = { id: 'mem-1', name: 'Fred Bumpass', tab_balance: '70.70' }

function renderModal(props = {}) {
  return render(
    <SettleTabModal
      member={props.member ?? MEMBER}
      onClose={props.onClose ?? vi.fn()}
      onSettled={props.onSettled ?? vi.fn()}
    />
  )
}

function chooseFull() {
  fireEvent.click(screen.getByRole('button', { name: /full balance/i }))
}

function choosePartial() {
  fireEvent.click(screen.getByRole('button', { name: /part payment/i }))
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSettleTab.mockResolvedValue(undefined)
  mockPrintReceipt.mockResolvedValue(undefined)
})

describe('SettleTabModal — choice step', () => {
  it('shows the member name and outstanding balance', () => {
    renderModal()
    expect(screen.getByText(/fred bumpass/i)).toBeInTheDocument()
    expect(screen.getAllByText(/£70\.70/).length).toBeGreaterThan(0)
  })

  it('offers an explicit choice: full balance (with amount) vs part payment', () => {
    renderModal()
    const full = screen.getByRole('button', { name: /full balance/i })
    expect(full).toHaveTextContent('£70.70')
    expect(screen.getByRole('button', { name: /part payment/i })).toBeInTheDocument()
  })

  it('lists Part payment before Full balance (safer option first)', () => {
    renderModal()
    const buttons = screen.getAllByRole('button').map(b => b.textContent)
    const partIdx = buttons.findIndex(t => /part payment/i.test(t))
    const fullIdx = buttons.findIndex(t => /full balance/i.test(t))
    expect(partIdx).toBeGreaterThan(-1)
    expect(partIdx).toBeLessThan(fullIdx)
  })

  it('does not pre-arm either choice: focus starts on the dialog, not a button', () => {
    renderModal()
    expect(document.activeElement).toBe(screen.getByRole('dialog'))
  })

  it('does NOT render an amount input on the choice step', () => {
    renderModal()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  })

  it('does NOT render settle buttons on the choice step', () => {
    renderModal()
    expect(screen.queryByRole('button', { name: /settle by cash/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /settle by card/i })).not.toBeInTheDocument()
  })

  it('calls onClose from the Cancel button', () => {
    const onClose = vi.fn()
    renderModal({ onClose })
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose on Escape', () => {
    const onClose = vi.fn()
    renderModal({ onClose })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})

describe('SettleTabModal — full balance path', () => {
  it('shows the full amount as fixed text, not an editable input', () => {
    renderModal()
    chooseFull()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
    expect(screen.getAllByText(/£70\.70/).length).toBeGreaterThan(0)
  })

  it('settles the FULL balance by card', async () => {
    const onSettled = vi.fn()
    renderModal({ onSettled })
    chooseFull()
    fireEvent.click(screen.getByRole('button', { name: /settle by card/i }))
    await waitFor(() => expect(mockSettleTab).toHaveBeenCalledWith('mem-1', 70.7, 'card'))
    await waitFor(() => expect(onSettled).toHaveBeenCalledWith(70.7))
  })

  it('routes cash through the cash modal with the full balance as total', async () => {
    renderModal()
    chooseFull()
    fireEvent.click(screen.getByRole('button', { name: /settle by cash/i }))
    expect(screen.getByTestId('cash-modal-total')).toHaveTextContent('70.70')
    expect(mockSettleTab).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /mock confirm cash/i }))
    await waitFor(() => expect(mockSettleTab).toHaveBeenCalledWith('mem-1', 70.7, 'cash'))
  })

  it('Back returns to the choice step', () => {
    renderModal()
    chooseFull()
    fireEvent.click(screen.getByRole('button', { name: /back/i }))
    expect(screen.getByRole('button', { name: /full balance/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /part payment/i })).toBeInTheDocument()
  })
})

describe('SettleTabModal — part payment path', () => {
  it('starts with an EMPTY amount field (never pre-filled)', () => {
    renderModal()
    choosePartial()
    expect(screen.getByRole('spinbutton')).toHaveValue(null)
  })

  it('settles the typed amount by card', async () => {
    const onSettled = vi.fn()
    renderModal({ onSettled })
    choosePartial()
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '40' } })
    fireEvent.click(screen.getByRole('button', { name: /settle by card/i }))
    await waitFor(() => expect(mockSettleTab).toHaveBeenCalledWith('mem-1', 40, 'card'))
    await waitFor(() => expect(onSettled).toHaveBeenCalledWith(40))
  })

  it('routes a partial cash payment through the cash modal with the typed amount', async () => {
    renderModal()
    choosePartial()
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '40' } })
    fireEvent.click(screen.getByRole('button', { name: /settle by cash/i }))
    expect(screen.getByTestId('cash-modal-total')).toHaveTextContent('40.00')

    fireEvent.click(screen.getByRole('button', { name: /mock confirm cash/i }))
    await waitFor(() => expect(mockSettleTab).toHaveBeenCalledWith('mem-1', 40, 'cash'))
  })

  it('rejects an empty amount', () => {
    renderModal()
    choosePartial()
    fireEvent.click(screen.getByRole('button', { name: /settle by card/i }))
    expect(screen.getByRole('alert')).toHaveTextContent(/valid amount/i)
    expect(mockSettleTab).not.toHaveBeenCalled()
  })

  it('rejects an amount above the balance', () => {
    renderModal()
    choosePartial()
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '80' } })
    fireEvent.click(screen.getByRole('button', { name: /settle by card/i }))
    expect(screen.getByRole('alert')).toHaveTextContent(/exceeds/i)
    expect(mockSettleTab).not.toHaveBeenCalled()
  })

  it('allows a part payment equal to the full balance', async () => {
    renderModal()
    choosePartial()
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '70.70' } })
    fireEvent.click(screen.getByRole('button', { name: /settle by card/i }))
    await waitFor(() => expect(mockSettleTab).toHaveBeenCalledWith('mem-1', 70.7, 'card'))
  })

  it('clears the typed amount when going Back and re-entering', () => {
    renderModal()
    choosePartial()
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '40' } })
    fireEvent.click(screen.getByRole('button', { name: /back/i }))
    choosePartial()
    expect(screen.getByRole('spinbutton')).toHaveValue(null)
  })

  it('rejects a sub-penny amount that rounds to zero', () => {
    renderModal()
    choosePartial()
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '0.001' } })
    fireEvent.click(screen.getByRole('button', { name: /settle by card/i }))
    expect(screen.getByRole('alert')).toHaveTextContent(/valid amount/i)
    expect(mockSettleTab).not.toHaveBeenCalled()
  })

  it('rounds amounts to whole pence before validating and settling', async () => {
    renderModal()
    choosePartial()
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '40.999' } })
    fireEvent.click(screen.getByRole('button', { name: /settle by card/i }))
    await waitFor(() => expect(mockSettleTab).toHaveBeenCalledWith('mem-1', 41, 'card'))
  })

  it('links the amount input to its hint, and to the error when invalid', () => {
    renderModal()
    choosePartial()
    const input = screen.getByRole('spinbutton')
    expect(input).toHaveAccessibleDescription(/of £70\.70 outstanding/i)
    expect(input).not.toHaveAttribute('aria-invalid', 'true')
    fireEvent.click(screen.getByRole('button', { name: /settle by card/i }))
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription(/valid amount/i)
  })
})

describe('SettleTabModal — cash modal integrity', () => {
  it('Back while the cash modal is open closes it and never settles', async () => {
    renderModal()
    choosePartial()
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '40' } })
    fireEvent.click(screen.getByRole('button', { name: /settle by cash/i }))
    expect(screen.getByTestId('cash-modal')).toBeInTheDocument()

    // The Back button is obscured by the overlay but still reachable by
    // keyboard — activating it must tear down the cash flow, not leave a
    // confirm wired to stale state (the NaN full-wipe regression).
    fireEvent.click(screen.getByRole('button', { name: /^back$/i }))
    expect(screen.queryByTestId('cash-modal')).not.toBeInTheDocument()
    expect(mockSettleTab).not.toHaveBeenCalled()
  })

  it('settles the amount snapshotted when the cash modal opened, even if state changed after', async () => {
    renderModal()
    choosePartial()
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '40' } })
    fireEvent.click(screen.getByRole('button', { name: /settle by cash/i }))
    // The amount input is still mounted under the overlay; a hardware
    // keyboard could edit it. The settle must use the snapshot, not live state.
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '9' } })
    fireEvent.click(screen.getByRole('button', { name: /mock confirm cash/i }))
    await waitFor(() => expect(mockSettleTab).toHaveBeenCalledWith('mem-1', 40, 'cash'))
  })
})

describe('SettleTabModal — failure handling', () => {
  it('ignores Escape and the X button while a settle is in flight', async () => {
    const onClose = vi.fn()
    const onSettled = vi.fn()
    let resolveSettle
    mockSettleTab.mockReturnValue(new Promise(r => { resolveSettle = r }))
    renderModal({ onClose, onSettled })
    chooseFull()
    fireEvent.click(screen.getByRole('button', { name: /settle by card/i }))

    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: /close settle tab modal/i }))
    expect(onClose).not.toHaveBeenCalled()

    resolveSettle()
    await waitFor(() => expect(onSettled).toHaveBeenCalled())
  })

  it('shows the error and keeps the modal open when settleTab fails', async () => {
    const onSettled = vi.fn()
    mockSettleTab.mockRejectedValue(new Error('network down'))
    renderModal({ onSettled })
    chooseFull()
    fireEvent.click(screen.getByRole('button', { name: /settle by card/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/network down/i)
    expect(onSettled).not.toHaveBeenCalled()
  })

  it('still completes the settle when printing fails (toast, no block)', async () => {
    const onSettled = vi.fn()
    mockPrintReceipt.mockRejectedValue(new Error('printer offline'))
    renderModal({ onSettled })
    chooseFull()
    fireEvent.click(screen.getByRole('button', { name: /settle by card/i }))
    await waitFor(() => expect(onSettled).toHaveBeenCalled())
    expect(mockAddToast).toHaveBeenCalledWith(expect.stringMatching(/print failed/i), 'error')
  })
})
