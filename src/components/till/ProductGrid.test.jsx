import { render, screen, fireEvent } from '@testing-library/react'
import ProductGrid from './ProductGrid'
import { useTillStore } from '../../stores/tillStore'

const mockProducts = [
  { id: '1', name: 'Guinness', category: 'draught', standard_price: 5.50, member_price: 4.50, stock_quantity: 10, par_level: 5 },
  { id: '2', name: 'Coke', category: 'soft', standard_price: 2.50, member_price: 2.00, stock_quantity: 2, par_level: 5 },
]

beforeEach(() => useTillStore.setState({ orderItems: [], activeMember: null }))

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
})
