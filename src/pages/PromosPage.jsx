// src/pages/PromosPage.jsx
import { useState, useEffect, useCallback } from 'react'
import { Plus } from '../lib/icons'
import { fetchAllPromotions, setPromotionActive } from '../lib/promotions'
import PromoList from '../components/promos/PromoList'
import PromoFormModal from '../components/promos/PromoFormModal'

export default function PromosPage() {
  const [promos, setPromos] = useState([])
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
    <div className="flex flex-col h-full min-h-0 p-4 gap-4 overflow-auto">
      {/* Page header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1
          className="text-2xl font-bold text-white"
          style={{ fontFamily: "'Playfair Display SC', serif" }}
        >
          Promos
        </h1>
        <button
          onClick={() => setPromoModal(null)}
          className="flex items-center gap-2 px-4 min-h-[44px] rounded-xl bg-[#22C55E] hover:bg-green-400 text-slate-900 font-bold text-sm transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
        >
          <Plus size={16} aria-hidden="true" />
          Add Promo
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 bg-[#0F172A] rounded-2xl border border-slate-700 overflow-hidden">
        {loading ? (
          <p className="text-slate-400 text-sm p-6 text-center">Loading promotions…</p>
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
