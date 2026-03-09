import { useState, useEffect, useCallback } from 'react'
import { fetchProducts } from '../lib/products'
import { supabase } from '../lib/supabase'
import { db } from '../lib/db'
import { useTillStore } from '../stores/tillStore'
import { useSyncStore } from '../stores/syncStore'
import CategoryFilter from '../components/till/CategoryFilter'
import ProductGrid from '../components/till/ProductGrid'
import OrderPanel from '../components/till/OrderPanel'

export default function TillPage() {
  const [products, setProducts] = useState([])
  const [category, setCategory] = useState('all')
  const [loading, setLoading] = useState(true)
  const { orderItems, activeMember, clearOrder } = useTillStore()
  const { isOnline } = useSyncStore()

  useEffect(() => {
    fetchProducts().then(setProducts).catch(console.error).finally(() => setLoading(false))
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

    if (isOnline) {
      const { data, error } = await supabase.from('orders').insert(order).select().single()
      if (!error) {
        await supabase.from('order_items').insert(items.map(i => ({ ...i, order_id: data.id })))
        if (paymentMethod === 'tab' && currentMember) {
          await supabase.from('members')
            .update({ tab_balance: (currentMember.tab_balance || 0) + total })
            .eq('id', currentMember.id)
        }
      }
    } else {
      await db.pendingOrders.add({ order, items })
    }

    clearOrder()
  }, [isOnline, clearOrder])

  const filtered = category === 'all' ? products : products.filter(p => p.category === category)

  return (
    <div className="flex h-full min-h-0">
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="p-4 space-y-3 overflow-auto flex-1">
          <CategoryFilter active={category} onChange={setCategory} />
          {loading
            ? <div className="text-slate-400 text-sm">Loading products...</div>
            : filtered.length === 0
              ? <div className="text-slate-400 text-sm">No products in this category</div>
              : <ProductGrid products={filtered} />}
        </div>
      </div>
      <div className="hidden md:flex">
        <OrderPanel onCheckout={handleCheckout} />
      </div>
    </div>
  )
}
