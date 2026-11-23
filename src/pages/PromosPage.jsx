// src/pages/PromosPage.jsx
import { useState, useEffect, useCallback } from 'react'
import { Plus } from '../lib/icons'
import { fetchAllPromotions, setPromotionActive } from '../lib/promotions'
import { fetchProducts } from '../lib/products'
import PromoList from '../components/promos/PromoList'
import PromoFormModal from '../components/promos/PromoFormModal'

export default function PromosPage() {
  const [promos, setPromos] = useState([])
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [promoModal, setPromoModal] = useState(undefined) // undefined=closed, null=add, object=edit

  const loadPromos = useCallback(() => {
    setLoading(true)
    fetchAllPromotions()
      .then(setPromos)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetchProducts().then(setProducts).catch(console.error)
  }, [])

  useEffect(() => {
    loadPromos()
  }, [loadPromos])

  async function handleToggle(promo) {
    try {
      await setPromotionActive(promo.id, !promo.active)
      setPromos(prev => prev.map(p => p.id === promo.id ? { ...p, active: !p.active } : p))
    } catch (err) {
      console.error('Failed to toggle promo:', err)
    }
  }

  function openEdit(promo) {
    setPromoModal(promo)
  }

  function closeModal() {
    setPromoModal(undefined)
  }

  return (
    <div className="ui-page">
      {/* Page header */}
      <div className="ui-page-header">
        <h1 className="ui-title">Promos</h1>
        <button
          onClick={() => setPromoModal(null)}
          className="ui-btn ui-btn-primary"
        >
          <Plus size={20} aria-hidden="true" />
          Add Promo
        </button>
      </div>

      {/* Content */}
      <div className="ui-card flex-1 min-h-[160px] overflow-auto">
        {loading ? (
          <p className="ui-empty">Loading promotions…</p>
        ) : (
          <PromoList
            promos={promos}
            onToggle={handleToggle}
            onEdit={openEdit}
          />
        )}
      </div>

      {/* Create / edit modal */}
      {promoModal !== undefined && (
        <PromoFormModal
          promo={promoModal}
          products={products}
          onClose={closeModal}
          onSaved={() => {
            closeModal()
            loadPromos()
          }}
        />
      )}
    </div>
  )
}
