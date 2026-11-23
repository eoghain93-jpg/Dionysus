import { useState, useEffect, useCallback } from 'react'
import { fetchProducts } from '../lib/products'
import { Plus, Search } from '../lib/icons'
import StockList from '../components/stock/StockList'
import StockMovementModal from '../components/stock/StockMovementModal'
import ProductFormModal from '../components/stock/ProductFormModal'

const CATEGORIES = ['all', 'draught', 'bottle', 'spirit', 'soft', 'food', 'other']

export default function StockPage() {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')

  // Modal state
  const [movementModal, setMovementModal] = useState(null) // { product, type }
  const [productModal, setProductModal] = useState(undefined) // undefined = closed, null = add, object = edit

  const loadProducts = useCallback(() => {
    setLoading(true)
    fetchProducts()
      .then(setProducts)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    loadProducts()
  }, [loadProducts])

  // Filtering
  const filtered = products.filter(p => {
    const matchesCategory = category === 'all' || p.category === category
    const matchesSearch = search.trim() === '' || p.name.toLowerCase().includes(search.trim().toLowerCase())
    return matchesCategory && matchesSearch
  })

  function openWastage(product) {
    setMovementModal({ product, type: 'wastage' })
  }

  function openRestock(product) {
    setMovementModal({ product, type: 'restock' })
  }

  function openEdit(product) {
    setProductModal(product)
  }

  function closeMovementModal() {
    setMovementModal(null)
  }

  function closeProductModal() {
    setProductModal(undefined)
  }

  return (
    <div className="ui-page">
      {/* Page header */}
      <div className="ui-page-header">
        <h1 className="ui-title">Stock</h1>
        <button
          onClick={() => setProductModal(null)}
          className="ui-btn ui-btn-primary"
        >
          <Plus size={20} aria-hidden="true" />
          Add Product
        </button>
      </div>

      {/* Search + category filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search
            size={20}
            aria-hidden="true"
            className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
          />
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search products…"
            aria-label="Search products"
            className="ui-input pl-12"
          />
        </div>

        <select
          value={category}
          onChange={e => setCategory(e.target.value)}
          aria-label="Filter by category"
          className="ui-select capitalize sm:min-w-[200px]"
        >
          {CATEGORIES.map(c => (
            <option key={c} value={c} className="capitalize">{c === 'all' ? 'All categories' : c}</option>
          ))}
        </select>
      </div>

      {/* Content */}
      <div className="ui-card flex-1 min-h-[320px] overflow-hidden flex flex-col">
        {loading ? (
          <p className="ui-empty">Loading products…</p>
        ) : (
          <StockList
            products={filtered}
            onWastage={openWastage}
            onRestock={openRestock}
            onEdit={openEdit}
          />
        )}
      </div>

      {/* Stock movement modal (wastage / spillage / restock) */}
      {movementModal && (
        <StockMovementModal
          product={movementModal.product}
          type={movementModal.type}
          onClose={closeMovementModal}
          onSaved={() => {
            closeMovementModal()
            loadProducts()
          }}
        />
      )}

      {/* Product form modal (add / edit) */}
      {productModal !== undefined && (
        <ProductFormModal
          product={productModal}
          onClose={closeProductModal}
          onSaved={() => {
            closeProductModal()
            loadProducts()
          }}
        />
      )}
    </div>
  )
}
