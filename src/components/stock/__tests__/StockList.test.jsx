import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import StockList, { getStockStatus } from '../StockList'

// Mock the products data layer (not used directly by StockList, but kept for completeness)
vi.mock('../../../lib/products', () => ({
  fetchProducts: vi.fn(),
  upsertProduct: vi.fn(),
  logStockMovement: vi.fn(),
}))

const noop = () => {}

const mockProducts = [
  {
    id: '1',
    name: 'Guinness',
    category: 'draught',
    stock_quantity: 2,
    par_level: 10,
    standard_price: 5.5,
    member_price: 4.5,
  },
  {
    id: '2',
    name: 'Coke',
    category: 'soft',
    stock_quantity: 20,
    par_level: 8,
    standard_price: 2.5,
    member_price: 2.0,
  },
  {
    id: '3',
    name: 'Lager',
    category: 'draught',
    stock_quantity: 12,
    par_level: 8,
    standard_price: 4.5,
    member_price: 3.5,
  },
]

describe('getStockStatus', () => {
  it('returns Good/Green when par_level is 0', () => {
    const status = getStockStatus(0, 0)
    expect(status.label).toBe('Good')
    expect(status.color).toBe('text-green-400')
  })

  it('returns Low/Red when stock_quantity < par_level', () => {
    const status = getStockStatus(2, 10)
    expect(status.label).toBe('Low')
    expect(status.color).toBe('text-red-400')
  })

  it('returns OK/Amber when stock_quantity equals par_level', () => {
    const status = getStockStatus(10, 10)
    expect(status.label).toBe('OK')
    expect(status.color).toBe('text-amber-400')
  })

  it('returns OK/Amber when stock_quantity is within par * 1.5', () => {
    const status = getStockStatus(14, 10)
    expect(status.label).toBe('OK')
  })

  it('returns Good/Green when stock_quantity > par_level * 1.5', () => {
    const status = getStockStatus(20, 8)
    expect(status.label).toBe('Good')
    expect(status.color).toBe('text-green-400')
  })
})

describe('StockList', () => {
  it('renders product names in the list', () => {
    render(<StockList products={mockProducts} onWastage={noop} onRestock={noop} onEdit={noop} />)
    expect(screen.getByText('Guinness')).toBeInTheDocument()
    expect(screen.getByText('Coke')).toBeInTheDocument()
    expect(screen.getByText('Lager')).toBeInTheDocument()
  })

  it('shows "Low" status label and AlertTriangle icon aria-label when stock < par', () => {
    render(<StockList products={mockProducts} onWastage={noop} onRestock={noop} onEdit={noop} />)
    // Guinness: stock 2, par 10 → Low
    expect(screen.getByText('Low')).toBeInTheDocument()
    // The badge has aria-label "Stock status: Low"
    expect(screen.getByLabelText('Stock status: Low')).toBeInTheDocument()
  })

  it('shows "Good" status label and CheckCircle aria-label when stock > par * 1.5', () => {
    render(<StockList products={mockProducts} onWastage={noop} onRestock={noop} onEdit={noop} />)
    // Coke: stock 20, par 8 → 20 > 12 → Good
    const goodBadges = screen.getAllByLabelText('Stock status: Good')
    expect(goodBadges.length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Good').length).toBeGreaterThanOrEqual(1)
  })

  it('shows "OK" status label when stock is at or near par', () => {
    render(<StockList products={mockProducts} onWastage={noop} onRestock={noop} onEdit={noop} />)
    // Lager: stock 12, par 8 → 12 <= 12 → OK
    expect(screen.getByText('OK')).toBeInTheDocument()
    expect(screen.getByLabelText('Stock status: OK')).toBeInTheDocument()
  })

  it('shows "No products found." when products array is empty', () => {
    render(<StockList products={[]} onWastage={noop} onRestock={noop} onEdit={noop} />)
    expect(screen.getByText('No products found.')).toBeInTheDocument()
  })

  it('renders action buttons for each product', () => {
    render(<StockList products={[mockProducts[0]]} onWastage={noop} onRestock={noop} onEdit={noop} />)
    expect(screen.getByLabelText(/Log wastage or spillage for Guinness/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Restock Guinness/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Edit Guinness/i)).toBeInTheDocument()
  })
})
