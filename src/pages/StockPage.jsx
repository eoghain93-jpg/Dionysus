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
    <div className="flex flex-col h-full min-h-0 p-4 gap-4 overflow-auto">
      {/* Page header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1
          className="text-2xl font-bold text-white"
        >
          Stock
        </h1>
        <button
          onClick={() => setProductModal(null)}
          className="flex items-center gap-2 px-4 min-h-[44px] rounded-xl bg-[#22C55E] hover:bg-green-400 text-slate-900 font-bold text-sm transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
        >
          <Plus size={16} aria-hidden="true" />
          Add Product
        </button>
      </div>

      {/* Search + category filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search
            size={16}
            aria-hidden="true"
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
          />
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search products…"
            aria-label="Search products"
            className="w-full bg-[#0F172A] border border-slate-700 rounded-xl pl-9 pr-3 py-2 text-white placeholder-slate-500 min-h-[44px] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
          />
        </div>

        <select
          value={category}
          onChange={e => setCategory(e.target.value)}
          aria-label="Filter by category"
          className="bg-[#0F172A] border border-slate-700 rounded-xl px-3 py-2 text-white min-h-[44px] capitalize focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617] cursor-pointer"
        >
          {CATEGORIES.map(c => (
            <option key={c} value={c} className="capitalize">{c === 'all' ? 'All categories' : c}</option>
          ))}
        </select>
      </div>

      {/* Content */}
      <div className="flex-1 bg-[#0F172A] rounded-2xl border border-slate-700 overflow-hidden">
        {loading ? (
          <p className="text-slate-400 text-sm p-6 text-center">Loading products…</p>
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
