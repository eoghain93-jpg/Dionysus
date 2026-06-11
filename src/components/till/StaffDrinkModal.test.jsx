import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import StaffDrinkModal from './StaffDrinkModal'

vi.mock('../../lib/stockMovements', () => ({
  logStaffDrink: vi.fn(),
}))

vi.mock('../../lib/staffCredits', () => ({
  fetchStaffMembers: vi.fn(),
  fetchBankedCredits: vi.fn(),
  redeemCredit: vi.fn(),
}))

vi.mock('../../stores/sessionStore', () => ({
  useSessionStore: vi.fn(() => ({ activeStaff: { id: 'staff-1', name: 'Dave' } })),
}))

import { logStaffDrink } from '../../lib/stockMovements'
import { fetchStaffMembers, fetchBankedCredits, redeemCredit } from '../../lib/staffCredits'

const mockProducts = [
  { id: 'p1', name: 'Guinness', category: 'draught' },
  { id: 'p2', name: 'Corona', category: 'bottle' },
]

beforeEach(() => {
  vi.clearAllMocks()
  fetchStaffMembers.mockResolvedValue([
    { id: 'staff-1', name: 'Dave' },
    { id: 'staff-2', name: 'Josh' },
  ])
  fetchBankedCredits.mockResolvedValue([])
  redeemCredit.mockResolvedValue(undefined)
})

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

  // ── Banked drinks ("one in for yourself") ──────────────────────────────────
  describe('banked credits', () => {
    const CREDITS = [
      { id: 'c-old', amount: 5.5, created_at: '2026-06-10T18:00:00Z', products: { name: 'Guinness' } },
      { id: 'c-new', amount: 4.8, created_at: '2026-06-11T19:00:00Z', products: { name: 'Carlsberg' } },
    ]

    it('shows no banked section when the staff member has none', async () => {
      render(<StaffDrinkModal products={mockProducts} onClose={vi.fn()} onSaved={vi.fn()} />)
      await waitFor(() => expect(fetchBankedCredits).toHaveBeenCalledWith('staff-1'))
      expect(screen.queryByText(/banked/i)).not.toBeInTheDocument()
    })

    it('shows the banked count when credits exist', async () => {
      fetchBankedCredits.mockResolvedValue(CREDITS)
      render(<StaffDrinkModal products={mockProducts} onClose={vi.fn()} onSaved={vi.fn()} />)
      expect(await screen.findByText(/2 banked drinks waiting/i)).toBeInTheDocument()
    })

    it('defaults the product picker to what was bought for the oldest credit', async () => {
      fetchBankedCredits.mockResolvedValue([
        { id: 'c-old', amount: 4.8, product_id: 'p2', created_at: '2026-06-10T18:00:00Z', products: { name: 'Corona' } },
      ])
      render(<StaffDrinkModal products={mockProducts} onClose={vi.fn()} onSaved={vi.fn()} />)
      await waitFor(() => expect(screen.getByLabelText(/product/i)).toHaveValue('p2'))
    })

    it('redeems the OLDEST credit with the selected product, recording who poured it', async () => {
      fetchBankedCredits.mockResolvedValue(CREDITS)
      const onSaved = vi.fn()
      render(<StaffDrinkModal products={mockProducts} onClose={vi.fn()} onSaved={onSaved} />)
      fireEvent.change(await screen.findByLabelText(/product/i), { target: { value: 'p2' } })
      fireEvent.click(screen.getByRole('button', { name: /redeem 1 banked drink/i }))
      await waitFor(() => expect(redeemCredit).toHaveBeenCalledWith('c-old', 'p2', 'staff-1'))
      await waitFor(() => expect(onSaved).toHaveBeenCalled())
      expect(logStaffDrink).not.toHaveBeenCalled()
    })

    it('shows an off-shift colleague\'s banked drinks when picked, and redeems on their behalf', async () => {
      // Dave is working; Josh is off shift on the customer side with credits banked.
      fetchBankedCredits.mockImplementation(id =>
        Promise.resolve(id === 'staff-2' ? CREDITS : [])
      )
      render(<StaffDrinkModal products={mockProducts} onClose={vi.fn()} onSaved={vi.fn()} />)
      await waitFor(() => expect(screen.getByRole('option', { name: /josh/i })).toBeInTheDocument())
      expect(screen.queryByText(/banked drink/i)).not.toBeInTheDocument()

      fireEvent.change(screen.getByLabelText(/whose drink/i), { target: { value: 'staff-2' } })
      expect(await screen.findByText(/josh has 2 banked drinks/i)).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: /redeem 1 banked drink/i }))
      // Josh's credit, poured and recorded by Dave (the active staff)
      await waitFor(() => expect(redeemCredit).toHaveBeenCalledWith('c-old', expect.any(String), 'staff-1'))
    })

    it('logs a free drink against the selected staff member, not the login', async () => {
      logStaffDrink.mockResolvedValue(undefined)
      render(<StaffDrinkModal products={mockProducts} onClose={vi.fn()} onSaved={vi.fn()} />)
      await waitFor(() => expect(screen.getByRole('option', { name: /josh/i })).toBeInTheDocument())
      fireEvent.change(screen.getByLabelText(/whose drink/i), { target: { value: 'staff-2' } })
      fireEvent.click(screen.getByRole('button', { name: /log drink/i }))
      await waitFor(() => expect(logStaffDrink).toHaveBeenCalledWith('p1', 1, 'staff-2'))
    })

    it('shows the error and stays open when redemption fails', async () => {
      fetchBankedCredits.mockResolvedValue(CREDITS)
      redeemCredit.mockRejectedValue(new Error('already redeemed'))
      const onSaved = vi.fn()
      render(<StaffDrinkModal products={mockProducts} onClose={vi.fn()} onSaved={onSaved} />)
      fireEvent.click(await screen.findByRole('button', { name: /redeem 1 banked drink/i }))
      expect(await screen.findByRole('alert')).toHaveTextContent(/already redeemed/i)
      expect(onSaved).not.toHaveBeenCalled()
    })
  })
})
