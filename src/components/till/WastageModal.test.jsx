import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import WastageModal from './WastageModal'

vi.mock('../../lib/stockMovements', () => ({
  logWastage: vi.fn(),
}))

import { logWastage } from '../../lib/stockMovements'

const mockProducts = [
  { id: 'p1', name: 'Guinness', category: 'draught' },
  { id: 'p2', name: 'Carlsberg', category: 'draught' },
  { id: 'p3', name: 'Corona', category: 'bottle' },
]

beforeEach(() => vi.clearAllMocks())

describe('WastageModal', () => {
  it('renders with role dialog', () => {
    render(<WastageModal products={mockProducts} onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('only shows draught products in dropdown', () => {
    render(<WastageModal products={mockProducts} onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(screen.getByRole('option', { name: 'Guinness' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Carlsberg' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Corona' })).not.toBeInTheDocument()
  })

  it('calls logWastage with correct args on submit', async () => {
    logWastage.mockResolvedValue()
    render(<WastageModal products={mockProducts} onClose={vi.fn()} onSaved={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(/quantity/i), { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => {
      expect(logWastage).toHaveBeenCalledWith('p1', 4)
    })
  })

  it('calls onSaved after successful save', async () => {
    logWastage.mockResolvedValue()
    const onSaved = vi.fn()
    render(<WastageModal products={mockProducts} onClose={vi.fn()} onSaved={onSaved} />)
    fireEvent.change(screen.getByLabelText(/quantity/i), { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
  })

  it('shows error when quantity is empty', async () => {
    render(<WastageModal products={mockProducts} onClose={vi.fn()} onSaved={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => {
      expect(screen.getByText(/valid quantity/i)).toBeInTheDocument()
    })
  })

  it('shows error when logWastage throws', async () => {
    logWastage.mockRejectedValue(new Error('DB error'))
    render(<WastageModal products={mockProducts} onClose={vi.fn()} onSaved={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(/quantity/i), { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(screen.getByText(/DB error/i)).toBeInTheDocument())
  })

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn()
    render(<WastageModal products={mockProducts} onClose={onClose} onSaved={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
