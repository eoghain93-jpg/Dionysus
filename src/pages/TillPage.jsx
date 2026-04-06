import { useState, useEffect, useCallback } from 'react'
import { fetchProducts } from '../lib/products'
import { fetchActivePromotions } from '../lib/promotions'
import { supabase } from '../lib/supabase'
import { addToTabBalance } from '../lib/members'
import { db } from '../lib/db'
import { printReceipt } from '../lib/starPrinter'
import { useToastStore } from '../hooks/useToast'
import { useTillStore } from '../stores/tillStore'
import { useSyncStore } from '../stores/syncStore'
import { useSessionStore } from '../stores/sessionStore'
import PinLoginScreen from '../components/till/PinLoginScreen'
import CategoryFilter from '../components/till/CategoryFilter'
import ProductGrid from '../components/till/ProductGrid'
import OrderPanel from '../components/till/OrderPanel'
import MemberLookup from '../components/till/MemberLookup'
import WastageModal from '../components/till/WastageModal'
import StaffDrinkModal from '../components/till/StaffDrinkModal'
import CashbackModal from '../components/till/CashbackModal'

export default function TillPage() {
  const [products, setProducts] = useState([])
  const [category, setCategory] = useState('all')
  const [loading, setLoading] = useState(true)
  const [showWastage, setShowWastage] = useState(false)
  const [showStaffDrink, setShowStaffDrink] = useState(false)
  const [showCashback, setShowCashback] = useState(false)
  const { orderItems, activeMember, clearOrder, loadPromos } = useTillStore()
  const { isOnline } = useSyncStore()
  const { activeStaff } = useSessionStore()

  useEffect(() => {
    fetchProducts().then(setProducts).catch(console.error).finally(() => setLoading(false))
    loadPromos(fetchActivePromotions)
  }, [])

  const handleCheckout = useCallback(async (paymentMethod) => {
    const total = useTillStore.getState().getTotal()
    const currentItems = useTillStore.getState().orderItems
    const currentMember = useTillStore.getState().activeMember

    const order = {
      member_id: currentMember?.id ?? null,
      payment_method: paymentMethod,
      total_amount: total,
      status: 'paid',
      till_id: 'till-1',
      created_at: new Date().toISOString(),
    }
    const items = currentItems.map(i => ({
      product_id: i.product_id,
      quantity: i.quantity,
      unit_price: i.unit_price,
      member_price_applied: i.member_price_applied,
    }))

    let orderId = `OFF-${Date.now()}`

    if (isOnline) {
      const { data, error } = await supabase.from('orders').insert(order).select().single()
      if (!error) {
        orderId = data.id
        await Promise.all([
          supabase.from('order_items').insert(items.map(i => ({ ...i, order_id: data.id }))),
          paymentMethod === 'tab' && currentMember
            ? addToTabBalance(currentMember.id, total)
            : Promise.resolve(),
        ])
      }
    } else {
      await db.pendingOrders.add({ order, items })
    }

    try {
      await printReceipt({ orderId, total, paymentMethod, createdAt: order.created_at })
    } catch {
      useToastStore.getState().addToast('Print failed — check printer connection', 'error')
    }

    clearOrder()
  }, [isOnline, clearOrder])

  if (!activeStaff) { return <PinLoginScreen /> }

  const filtered = category === 'all' ? products : products.filter(p => p.category === category)

  return (
    <div className="flex h-full min-h-0">
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="p-4 space-y-3 overflow-auto flex-1">
          <MemberLookup />
          <CategoryFilter active={category} onChange={setCategory} />
          {loading
            ? <div className="text-slate-400 text-sm">Loading products...</div>
            : filtered.length === 0
              ? <div className="text-slate-400 text-sm">No products in this category</div>
              : <ProductGrid products={filtered} />}
          <div className="flex gap-2 pt-2">
            <button
              onClick={() => setShowWastage(true)}
              className="flex-1 min-h-[44px] rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-sm font-medium cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
            >
              Record Wastage
            </button>
            <button
              onClick={() => setShowStaffDrink(true)}
              className="flex-1 min-h-[44px] rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-sm font-medium cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
            >
              Staff Drink
            </button>
            <button
              onClick={() => setShowCashback(true)}
              className="flex-1 min-h-[44px] rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-sm font-medium cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
            >
              Cashback
            </button>
          </div>
        </div>
      </div>
      <div className="hidden md:flex">
        <OrderPanel onCheckout={handleCheckout} />
      </div>
      {showWastage && (
        <WastageModal
          products={products}
          onClose={() => setShowWastage(false)}
          onSaved={() => setShowWastage(false)}
        />
      )}
      {showStaffDrink && (
        <StaffDrinkModal
          products={products}
          onClose={() => setShowStaffDrink(false)}
          onSaved={() => setShowStaffDrink(false)}
        />
      )}
      {showCashback && (
        <CashbackModal
          onClose={() => setShowCashback(false)}
          onSaved={() => setShowCashback(false)}
        />
      )}
    </div>
  )
}
