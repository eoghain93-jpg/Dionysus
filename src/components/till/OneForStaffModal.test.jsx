import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import OneForStaffModal from './OneForStaffModal'

const { mockFetchStaff } = vi.hoisted(() => ({ mockFetchStaff: vi.fn() }))

vi.mock('../../lib/staffCredits', () => ({
  fetchStaffMembers: mockFetchStaff,
}))

vi.mock('../../stores/sessionStore', () => ({
  useSessionStore: () => ({ activeStaff: { id: 's2', name: 'Eve Gallagher' } }),
}))

const PRODUCTS = [
  { id: 'p1', name: 'Guinness', standard_price: 5.5 },
  { id: 'p2', name: 'Carlsberg', standard_price: 4.8 },
]
const STAFF = [
  { id: 's1', name: 'Dave O Brien' },
  { id: 's2', name: 'Eve Gallagher' },
]

function renderModal(props = {}) {
  return render(
    <OneForStaffModal
      products={props.products ?? PRODUCTS}
      onAdd={props.onAdd ?? vi.fn()}
      onClose={props.onClose ?? vi.fn()}
    />
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFetchStaff.mockResolvedValue(STAFF)
})

describe('OneForStaffModal', () => {
  it('loads the staff list and defaults to the logged-in staff member', async () => {
    renderModal()
    await waitFor(() => expect(screen.getByLabelText(/for staff member/i)).toHaveValue('s2'))
  })

  it('shows the standard price of the selected drink', async () => {
    renderModal()
    await waitFor(() => expect(mockFetchStaff).toHaveBeenCalled())
    expect(screen.getByText(/£5\.50/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/drink/i), { target: { value: 'p2' } })
    expect(screen.getByText(/£4\.80/)).toBeInTheDocument()
  })

  it('calls onAdd with the chosen product and staff member', async () => {
    const onAdd = vi.fn()
    renderModal({ onAdd })
    await waitFor(() => expect(screen.getByLabelText(/for staff member/i)).toHaveValue('s2'))
    fireEvent.change(screen.getByLabelText(/for staff member/i), { target: { value: 's1' } })
    fireEvent.change(screen.getByLabelText(/drink/i), { target: { value: 'p2' } })
    fireEvent.click(screen.getByRole('button', { name: /add to order/i }))
    expect(onAdd).toHaveBeenCalledWith(PRODUCTS[1], STAFF[0])
  })

  it('calls onClose from Cancel', async () => {
    const onClose = vi.fn()
    renderModal({ onClose })
    await waitFor(() => expect(mockFetchStaff).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows an error when the staff list fails to load', async () => {
    mockFetchStaff.mockRejectedValue(new Error('offline'))
    renderModal()
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load staff/i)
  })
})
