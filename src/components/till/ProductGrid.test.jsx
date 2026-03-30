import { render, screen, fireEvent } from '@testing-library/react'
import ProductGrid from './ProductGrid'
import { useTillStore } from '../../stores/tillStore'

const mockProducts = [
  { id: '1', name: 'Guinness', category: 'draught', standard_price: 5.50, member_price: 4.50, stock_quantity: 10, par_level: 5 },
  { id: '2', name: 'Coke', category: 'soft', standard_price: 2.50, member_price: 2.00, stock_quantity: 2, par_level: 5 },
]

beforeEach(() => useTillStore.setState({ orderItems: [], activeMember: null, activePromos: [] }))

describe('ProductGrid', () => {
  it('renders all products', () => {
    render(<ProductGrid products={mockProducts} />)
    expect(screen.getByText('Guinness')).toBeInTheDocument()
    expect(screen.getByText('Coke')).toBeInTheDocument()
  })

  it('adds product to order on click', () => {
    render(<ProductGrid products={mockProducts} />)
    fireEvent.click(screen.getByText('Guinness'))
    expect(useTillStore.getState().orderItems).toHaveLength(1)
  })

  it('shows standard price when no member active', () => {
    render(<ProductGrid products={mockProducts} />)
    expect(screen.getByText('£5.50')).toBeInTheDocument()
  })

  it('shows member price when member is active', () => {
    useTillStore.setState({ activeMember: { id: 'm1', name: 'Test' } })
    render(<ProductGrid products={mockProducts} />)
    expect(screen.getByText('£4.50')).toBeInTheDocument()
  })

  // ---------------------------------------------------------------------------
  // PROMO badge tests
  // ---------------------------------------------------------------------------

  const mockPromos = [
    {
      id: 'promo-1',
      name: 'Happy Hour',
      active: true,
      start_time: '17:00',
      end_time: '19:00',
      days_of_week: null,
      start_date: null,
      end_date: null,
      promotion_items: [
        {
          id: 'pi-1',
          promotion_id: 'promo-1',
          product_id: '1',
          discount_type: 'percentage',
          discount_value: 20,
        },
      ],
    },
  ]

  it('shows PROMO badge on a product that has an active promo at the current time', () => {
    useTillStore.setState({ activePromos: mockPromos })
    const mondayEvening = new Date('2026-03-30T18:00:00')
    render(<ProductGrid products={mockProducts} now={mondayEvening} />)
    expect(screen.getByLabelText('Promotion active')).toBeInTheDocument()
  })

  it('does not show PROMO badge when no promos are active', () => {
    useTillStore.setState({ activePromos: [] })
    render(<ProductGrid products={mockProducts} />)
    expect(screen.queryByLabelText('Promotion active')).not.toBeInTheDocument()
  })

  it('does not show PROMO badge on a product not covered by any promo', () => {
    useTillStore.setState({ activePromos: mockPromos })
    const mondayEvening = new Date('2026-03-30T18:00:00')
    render(<ProductGrid products={mockProducts} now={mondayEvening} />)
    // prod-2 (Coke) is not in the promo — only prod-1 (Guinness) badge should appear
    const badges = screen.queryAllByLabelText('Promotion active')
    expect(badges).toHaveLength(1)
  })

  it('shows the promo price on the tile when a promo is active', () => {
    useTillStore.setState({ activePromos: mockPromos })
    const mondayEvening = new Date('2026-03-30T18:00:00')
    render(<ProductGrid products={mockProducts} now={mondayEvening} />)
    // 20% off £5.50 = £4.40
    expect(screen.getByText('£4.40')).toBeInTheDocument()
  })

  it('does not show PROMO badge outside the promo time window', () => {
    useTillStore.setState({ activePromos: mockPromos })
    const mondayMorning = new Date('2026-03-30T10:00:00')
    render(<ProductGrid products={mockProducts} now={mondayMorning} />)
    expect(screen.queryByLabelText('Promotion active')).not.toBeInTheDocument()
  })
})
