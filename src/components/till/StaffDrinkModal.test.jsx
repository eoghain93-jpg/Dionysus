import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import StaffDrinkModal from './StaffDrinkModal'

vi.mock('../../lib/stockMovements', () => ({
  logStaffDrink: vi.fn(),
}))

vi.mock('../../stores/sessionStore', () => ({
  useSessionStore: vi.fn(() => ({ activeStaff: { id: 'staff-1', name: 'Dave' } })),
}))

import { logStaffDrink } from '../../lib/stockMovements'

const mockProducts = [
  { id: 'p1', name: 'Guinness', category: 'draught' },
  { id: 'p2', name: 'Corona', category: 'bottle' },
]

beforeEach(() => vi.clearAllMocks())

describe('StaffDrinkModal', () => {
  it('renders with role dialog', () => {
    render(<StaffDrinkModal products={mockProducts} onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('shows the active staff member name', () => {
    render(<StaffDrinkModal products={mockProducts} onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(screen.getByText('Dave')).toBeInTheDocument()
  })

  it('shows all products in dropdown', () => {
    render(<StaffDrinkModal products={mockProducts} onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(screen.getByRole('option', { name: 'Guinness' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Corona' })).toBeInTheDocument()
  })

  it('defaults quantity to 1', () => {
    render(<StaffDrinkModal products={mockProducts} onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(screen.getByLabelText(/quantity/i)).toHaveValue(1)
  })

  it('calls logStaffDrink with correct args on submit', async () => {
    logStaffDrink.mockResolvedValue()
    render(<StaffDrinkModal products={mockProducts} onClose={vi.fn()} onSaved={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /log drink/i }))
    await waitFor(() => {
      expect(logStaffDrink).toHaveBeenCalledWith('p1', 1, 'staff-1')
    })
  })

  it('calls onSaved after successful save', async () => {
    logStaffDrink.mockResolvedValue()
    const onSaved = vi.fn()
    render(<StaffDrinkModal products={mockProducts} onClose={vi.fn()} onSaved={onSaved} />)
    fireEvent.click(screen.getByRole('button', { name: /log drink/i }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
  })

  it('shows error when logStaffDrink throws', async () => {
    logStaffDrink.mockRejectedValue(new Error('DB error'))
    render(<StaffDrinkModal products={mockProducts} onClose={vi.fn()} onSaved={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /log drink/i }))
    await waitFor(() => expect(screen.getByText(/DB error/i)).toBeInTheDocument())
  })

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn()
    render(<StaffDrinkModal products={mockProducts} onClose={onClose} onSaved={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
