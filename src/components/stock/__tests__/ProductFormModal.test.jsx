import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockUpsertProduct = vi.fn()
vi.mock('../../../lib/products', () => ({
  upsertProduct: (...args) => mockUpsertProduct(...args),
}))

// PinGate talks to the verify-pin edge function; stand in a button that
// confirms, so these tests cover when the gate appears and what happens after.
vi.mock('../../till/PinGate', () => ({
  default: ({ onConfirm, onCancel, label }) => (
    <div data-testid="pin-gate">
      <span>{label}</span>
      <button onClick={onConfirm}>Mock PIN OK</button>
      <button onClick={onCancel}>Mock PIN Cancel</button>
    </div>
  ),
}))

import ProductFormModal from '../ProductFormModal'
import { useSessionStore } from '../../../stores/sessionStore'

const GUINNESS = {
  id: 'p1',
  name: 'Guinness',
  category: 'draught',
  standard_price: 7.4,
  member_price: 6.4,
  stock_quantity: 10,
  par_level: 5,
  unit: 'pint',
}

function renderModal(product = GUINNESS) {
  const onSaved = vi.fn()
  render(<ProductFormModal product={product} onClose={vi.fn()} onSaved={onSaved} />)
  return { onSaved }
}

function save() {
  fireEvent.click(screen.getByRole('button', { name: /save changes|add product/i }))
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUpsertProduct.mockResolvedValue({})
  useSessionStore.setState({ activeStaff: { id: 'staff-1', name: 'Sam Staff' } })
})

describe('ProductFormModal — price changes are PIN-confirmed and attributed', () => {
  it('asks for a PIN before saving a changed price, then records who changed it', async () => {
    const { onSaved } = renderModal()
    fireEvent.change(screen.getByLabelText(/standard price/i), { target: { value: '6.40' } })
    save()

    expect(screen.getByTestId('pin-gate')).toBeInTheDocument()
    expect(mockUpsertProduct).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('Mock PIN OK'))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(mockUpsertProduct).toHaveBeenCalledWith(expect.objectContaining({
      id: 'p1',
      standard_price: 6.4,
      member_price: 6.4,
      changed_by: 'staff-1',
    }))
  })

  it('saves nothing if the PIN prompt is cancelled', () => {
    renderModal()
    fireEvent.change(screen.getByLabelText(/member price/i), { target: { value: '5.00' } })
    save()
    fireEvent.click(screen.getByText('Mock PIN Cancel'))

    expect(screen.queryByTestId('pin-gate')).not.toBeInTheDocument()
    expect(mockUpsertProduct).not.toHaveBeenCalled()
  })

  it('refuses a price change when nobody is signed in', () => {
    useSessionStore.setState({ activeStaff: null })
    renderModal()
    fireEvent.change(screen.getByLabelText(/standard price/i), { target: { value: '6.40' } })
    save()

    expect(screen.getByRole('alert')).toHaveTextContent(/sign in on the till/i)
    expect(screen.queryByTestId('pin-gate')).not.toBeInTheDocument()
    expect(mockUpsertProduct).not.toHaveBeenCalled()
  })

  it('saves edits that leave both prices alone without a PIN', async () => {
    useSessionStore.setState({ activeStaff: null })
    const { onSaved } = renderModal()
    fireEvent.change(screen.getByLabelText(/par level/i), { target: { value: '8' } })
    save()

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(screen.queryByTestId('pin-gate')).not.toBeInTheDocument()
    const payload = mockUpsertProduct.mock.calls[0][0]
    expect(payload.par_level).toBe(8)
    expect(payload).not.toHaveProperty('changed_by')
  })

  it('treats a new product as a price change', () => {
    renderModal(null)
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'New Lager' } })
    fireEvent.change(screen.getByLabelText(/standard price/i), { target: { value: '5.00' } })
    fireEvent.change(screen.getByLabelText(/member price/i), { target: { value: '4.50' } })
    fireEvent.change(screen.getByLabelText(/stock quantity/i), { target: { value: '0' } })
    fireEvent.change(screen.getByLabelText(/par level/i), { target: { value: '0' } })
    save()

    expect(screen.getByTestId('pin-gate')).toBeInTheDocument()
    expect(mockUpsertProduct).not.toHaveBeenCalled()
  })
})
