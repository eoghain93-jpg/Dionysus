// src/pages/PromosPage.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import PromosPage from './PromosPage'

vi.mock('../lib/promotions', () => ({
  fetchAllPromotions: vi.fn(),
  fetchActivePromotions: vi.fn(),
  setPromotionActive: vi.fn(),
  deletePromotion: vi.fn(),
  upsertPromotion: vi.fn(),
  replacePromotionItems: vi.fn(),
}))

import {
  fetchAllPromotions,
  setPromotionActive,
} from '../lib/promotions'

const mockPromos = [
  {
    id: 'promo-1',
    name: 'Happy Hour',
    active: true,
    start_time: '17:00',
    end_time: '19:00',
    days_of_week: [1, 2, 3, 4, 5],
    start_date: null,
    end_date: null,
    promotion_items: [],
  },
  {
    id: 'promo-2',
    name: 'Quiz Night',
    active: false,
    start_time: null,
    end_time: null,
    days_of_week: null,
    start_date: '2026-04-10',
    end_date: '2026-04-10',
    promotion_items: [],
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  fetchAllPromotions.mockResolvedValue(mockPromos)
  setPromotionActive.mockResolvedValue({})
})

describe('PromosPage', () => {
  it('renders the page heading', async () => {
    render(<PromosPage />)
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /promos/i })).toBeInTheDocument()
    })
  })

  it('shows an "Add Promo" button', async () => {
    render(<PromosPage />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /add promo/i })).toBeInTheDocument()
    })
  })

  it('displays a loading state initially', () => {
    fetchAllPromotions.mockReturnValue(new Promise(() => {})) // never resolves
    render(<PromosPage />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('lists all promotions by name', async () => {
    render(<PromosPage />)
    await waitFor(() => {
      expect(screen.getByText('Happy Hour')).toBeInTheDocument()
      expect(screen.getByText('Quiz Night')).toBeInTheDocument()
    })
  })

  it('shows active state toggle for each promo', async () => {
    render(<PromosPage />)
    await waitFor(() => {
      const toggles = screen.getAllByRole('switch')
      expect(toggles).toHaveLength(2)
    })
  })

  it('calls setPromotionActive when a toggle is clicked', async () => {
    setPromotionActive.mockResolvedValue({ id: 'promo-1', active: false })
    render(<PromosPage />)
    await waitFor(() => screen.getByText('Happy Hour'))
    const toggles = screen.getAllByRole('switch')
    fireEvent.click(toggles[0]) // toggle Happy Hour
    await waitFor(() => {
      expect(setPromotionActive).toHaveBeenCalledWith('promo-1', false)
    })
  })

  it('shows an edit button for each promo', async () => {
    render(<PromosPage />)
    await waitFor(() => {
      const editButtons = screen.getAllByRole('button', { name: /edit/i })
      expect(editButtons.length).toBeGreaterThanOrEqual(2)
    })
  })

  it('opens the create modal when "Add Promo" is clicked', async () => {
    render(<PromosPage />)
    await waitFor(() => screen.getByRole('button', { name: /add promo/i }))
    fireEvent.click(screen.getByRole('button', { name: /add promo/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('opens the edit modal when an edit button is clicked', async () => {
    render(<PromosPage />)
    await waitFor(() => screen.getAllByRole('button', { name: /edit/i }))
    fireEvent.click(screen.getAllByRole('button', { name: /edit/i })[0])
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('shows the promo name pre-filled in edit modal', async () => {
    render(<PromosPage />)
    await waitFor(() => screen.getAllByRole('button', { name: /edit/i }))
    fireEvent.click(screen.getAllByRole('button', { name: /edit/i })[0])
    await waitFor(() => {
      expect(screen.getByDisplayValue('Happy Hour')).toBeInTheDocument()
    })
  })

  it('shows time-window fields for a time-based promo', async () => {
    render(<PromosPage />)
    await waitFor(() => screen.getAllByRole('button', { name: /edit/i }))
    fireEvent.click(screen.getAllByRole('button', { name: /edit/i })[0])
    await waitFor(() => {
      expect(screen.getByLabelText(/start time/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/end time/i)).toBeInTheDocument()
    })
  })

  it('closes the modal when Cancel is clicked', async () => {
    render(<PromosPage />)
    await waitFor(() => screen.getByRole('button', { name: /add promo/i }))
    fireEvent.click(screen.getByRole('button', { name: /add promo/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows empty state message when no promotions exist', async () => {
    fetchAllPromotions.mockResolvedValue([])
    render(<PromosPage />)
    await waitFor(() => {
      expect(screen.getByText(/no promotions/i)).toBeInTheDocument()
    })
  })
})
