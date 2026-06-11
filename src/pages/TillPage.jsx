import { useState, useEffect, useCallback } from 'react'
import { ShoppingCart } from 'lucide-react'
import { fetchProducts } from '../lib/products'
import { fetchActivePromotions } from '../lib/promotions'
import { newOrderId, saveOrder } from '../lib/orders'
import { getTillId } from '../lib/till'
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
import OneForStaffModal from '../components/till/OneForStaffModal'
import CashbackModal from '../components/till/CashbackModal'
import RecentSalesModal from '../components/till/RecentSalesModal'
import PrizeWinModal from '../components/till/PrizeWinModal'
import MembersOnlyToggle from '../components/till/MembersOnlyToggle'
import ShotBundleModal from '../components/till/ShotBundleModal'

export default function TillPage() {
  const [products, setProducts] = useState([])
  const [category, setCategory] = useState('all')
  const [loading, setLoading] = useState(true)
  const [showWastage, setShowWastage] = useState(false)
  const [showStaffDrink, setShowStaffDrink] = useState(false)
  const [showOneForStaff, setShowOneForStaff] = useState(false)
  const [showCashback, setShowCashback] = useState(false)
  const [showPrizeWin, setShowPrizeWin] = useState(false)
  const [showShotBundle, setShowShotBundle] = useState(false)
  const [showRecentSales, setShowRecentSales] = useState(false)
  const [showMobileOrder, setShowMobileOrder] = useState(false)
  const { orderItems, clearOrder, loadPromos, getTotal } = useTillStore()
  const setMembersOnlyMode = useTillStore(s => s.setMembersOnlyMode)
  const { isOnline } = useSyncStore()
  const { activeStaff } = useSessionStore()

  // Auto-clear event-wide members pricing on staff change so the next staff
  // member doesn't unknowingly inherit a previous shift's pricing mode.
  useEffect(() => {
    if (!activeStaff) setMembersOnlyMode(false)
  }, [activeStaff?.id, setMembersOnlyMode])

  useEffect(() => {
    fetchProducts().then(setProducts).catch(console.error).finally(() => setLoading(false))
    loadPromos(fetchActivePromotions)
  }, [])

  // Auto-close mobile order sheet after checkout clears the cart
  useEffect(() => {
    if (orderItems.length === 0) setShowMobileOrder(false)
  }, [orderItems.length])

  const handleCheckout = useCallback(async (paymentMethod) => {
    const total = useTillStore.getState().getTotal()
    const currentItems = useTillStore.getState().orderItems
    const currentMember = useTillStore.getState().activeMember

    const order = {
      // Client-generated id: the create_order_with_items RPC upserts on it,
      // so an offline order replayed by sync can never duplicate.
      id: newOrderId(),
      member_id: currentMember?.id ?? null,
      payment_method: paymentMethod,
      total_amount: total,
      status: 'paid',
      till_id: getTillId(),
      created_at: new Date().toISOString(),
    }
    const items = currentItems.map(i => ({
      product_id: i.product_id,
      quantity: i.quantity,
      unit_price: i.unit_price,
      member_price_applied: i.member_price_applied,
      // "One for staff" lines: the RPC banks a staff_drink_credits row per
      // unit and skips the sale stock movement for them.
      staff_credit_for: i.staff_credit_for ?? null,
    }))

    // One atomic RPC writes the order, items, sale stock movements and any
    // tab balance increment; on failure the order falls back to the offline
    // queue. saveOrder never throws — whatever happens we proceed to print +
    // clearOrder below so the till can't get stuck mid-sale.
    const saved = await saveOrder(order, items, isOnline)
    if (saved === 'fallback') {
      useToastStore.getState().addToast('Saved offline — will sync', 'error')
    } else if (saved === 'failed') {
      useToastStore.getState().addToast('Order save failed — check sync', 'error')
    }

    try {
      await printReceipt({ orderId: order.id, total, paymentMethod, createdAt: order.created_at })
    } catch (err) {
      console.error('Print failed:', err)
      useToastStore.getState().addToast('Print failed — check printer connection', 'error')
    }

    clearOrder()
  }, [isOnline, clearOrder])

  if (!activeStaff) { return <PinLoginScreen /> }

  const CATEGORY_ORDER = ['draught', 'bottle', 'spirit', 'soft', 'food', 'other']
  const sorted = [...products].sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category))
  const filtered = category === 'all' ? sorted : sorted.filter(p => p.category === category)

  return (
    <div className="flex h-full min-h-0">
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="p-4 space-y-3 overflow-auto flex-1">
          <MembersOnlyToggle />
          <MemberLookup />
          <CategoryFilter active={category} onChange={setCategory} />
          <div className="flex gap-2">
            <button
              onClick={() => setShowWastage(true)}
              className="px-3 min-h-[36px] rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400 text-xs font-medium cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
            >
              Wastage
            </button>
            <button
              onClick={() => setShowStaffDrink(true)}
              className="px-3 min-h-[36px] rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400 text-xs font-medium cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
            >
              Staff Drink
            </button>
            <button
              onClick={() => setShowOneForStaff(true)}
              className="px-3 min-h-[36px] rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400 text-xs font-medium cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
            >
              One for Staff
            </button>
            <button
              onClick={() => setShowCashback(true)}
              className="px-3 min-h-[36px] rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400 text-xs font-medium cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
            >
              Cashback
            </button>
            <button
              onClick={() => setShowPrizeWin(true)}
              className="px-3 min-h-[36px] rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400 text-xs font-medium cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
            >
              Prize Win
            </button>
            <button
              onClick={() => setShowShotBundle(true)}
              className="px-3 min-h-[36px] rounded-lg bg-purple-900 hover:bg-purple-800 border border-purple-700 text-purple-100 text-xs font-bold cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
            >
              4 Shots £10
            </button>
            <button
              onClick={() => setShowRecentSales(true)}
              className="px-3 min-h-[36px] rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400 text-xs font-medium cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
            >
              Fix Payment
            </button>
          </div>
          {loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
              {Array.from({ length: 10 }).map((_, i) => (
                <div
                  key={i}
                  className="bg-slate-800 rounded-xl min-h-[80px] animate-pulse motion-reduce:animate-none"
                />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-slate-400 text-sm">No products in this category</div>
          ) : (
            <ProductGrid products={filtered} />
          )}
        </div>
      </div>
      <div className="hidden md:flex">
        <OrderPanel onCheckout={handleCheckout} />
      </div>

      {/* Mobile: floating order button */}
      {orderItems.length > 0 && (
        <button
          onClick={() => setShowMobileOrder(true)}
          aria-label={`View order — ${orderItems.length} item${orderItems.length > 1 ? 's' : ''}, £${getTotal().toFixed(2)}`}
          className="md:hidden fixed bottom-20 right-4 z-30 flex items-center gap-2
            bg-blue-600 hover:bg-blue-500 active:scale-95 text-white font-semibold
            px-4 py-3 rounded-2xl shadow-xl transition-all duration-150 cursor-pointer
            focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-[#020617]"
        >
          <ShoppingCart size={18} aria-hidden="true" />
          <span>{orderItems.length}</span>
          <span className="text-blue-200 font-normal">·</span>
          <span>£{getTotal().toFixed(2)}</span>
        </button>
      )}

      {/* Mobile: order bottom sheet */}
      {showMobileOrder && (
        <div className="md:hidden fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Order">
          <div
            className="absolute inset-0 bg-black/70"
            onClick={() => setShowMobileOrder(false)}
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-auto rounded-t-2xl">
            <OrderPanel onCheckout={handleCheckout} onClose={() => setShowMobileOrder(false)} />
          </div>
        </div>
      )}
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
      {showOneForStaff && (
        <OneForStaffModal
          products={products}
          onAdd={(product, staffMember) => {
            useTillStore.getState().addStaffCreditItem(product, staffMember)
            setShowOneForStaff(false)
          }}
          onClose={() => setShowOneForStaff(false)}
        />
      )}
      {showCashback && (
        <CashbackModal
          onClose={() => setShowCashback(false)}
          onSaved={() => setShowCashback(false)}
        />
      )}
      {showPrizeWin && (
        <PrizeWinModal
          onClose={() => setShowPrizeWin(false)}
          onSaved={() => setShowPrizeWin(false)}
        />
      )}
      {showShotBundle && (
        <ShotBundleModal
          products={products}
          onClose={() => setShowShotBundle(false)}
        />
      )}
      {showRecentSales && (
        <RecentSalesModal onClose={() => setShowRecentSales(false)} />
      )}
    </div>
  )
}
