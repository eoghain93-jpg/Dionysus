import { useState, useEffect, useCallback, useRef } from 'react'
import { ShoppingCart, Beer, GlassWater, Trash2, Banknote, Trophy, UserPlus, RotateCcw } from 'lucide-react'
import { fetchProducts } from '../lib/products'
import { fetchActivePromotions } from '../lib/promotions'
import { isBundleEnabled } from '../lib/promos'
import { newOrderId, saveOrder } from '../lib/orders'
import { getTillId } from '../lib/till'
import { fetchTabAges, isTabBlocked } from '../lib/tabs'
import { fetchPopularProductIds, fetchMemberUsual, planUsual } from '../lib/favourites'
import { SHOT_BUNDLE_QTY, SHOT_BUNDLE_TOTAL, isShotBundleEligible } from '../lib/shotBundle'
import { findMemberByNumber } from '../lib/members'
import { printReceipt, getPrinterIp } from '../lib/starPrinter'
import { logEvent } from '../lib/audit/log'
import { useToastStore } from '../hooks/useToast'
import { useTillStore } from '../stores/tillStore'
import { useSyncStore } from '../stores/syncStore'
import { useSessionStore } from '../stores/sessionStore'
import PinLoginScreen from '../components/till/PinLoginScreen'
import CategoryFilter from '../components/till/CategoryFilter'
import ProductGrid, { TILE_MIN_HEIGHT, TILE_GAP } from '../components/till/ProductGrid'
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
import BottleBundleModal from '../components/till/BottleBundleModal'
import GuestSignInModal from '../components/guests/GuestSignInModal'
import { BOTTLE_BUNDLE_PROMO_NAME, isBottleBundleEligible } from '../lib/bottleBundle'

// How long the Undo prompt stays up after a tile tap.
const UNDO_MS = 5000
// The grid area's bottom padding (pb-3), left out when counting rows.
const GRID_BOTTOM_PADDING = 12

export default function TillPage() {
  const [products, setProducts] = useState([])
  const [category, setCategory] = useState('popular')
  // Best-selling product ids (drives the Popular tab) and the active member's
  // usual order ([{ product_id, quantity }]).
  const [popularIds, setPopularIds] = useState([])
  const [usual, setUsual] = useState([])
  // The last tile tapped ({ id, name }), offered back as an Undo prompt.
  const [undo, setUndo] = useState(null)
  // How many tiles the grid area can show without scrolling on THIS screen.
  // The Popular tab is trimmed to it, so the till's main screen never scrolls.
  const gridAreaRef = useRef(null)
  const [gridCapacity, setGridCapacity] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showWastage, setShowWastage] = useState(false)
  const [showStaffDrink, setShowStaffDrink] = useState(false)
  const [showOneForStaff, setShowOneForStaff] = useState(false)
  const [showCashback, setShowCashback] = useState(false)
  const [showPrizeWin, setShowPrizeWin] = useState(false)
  const [showShotBundle, setShowShotBundle] = useState(false)
  const [showBottleBundle, setShowBottleBundle] = useState(false)
  const [showRecentSales, setShowRecentSales] = useState(false)
  const [showGuestSignIn, setShowGuestSignIn] = useState(false)
  const [showMobileOrder, setShowMobileOrder] = useState(false)
  const { orderItems, clearOrder, loadPromos, getTotal } = useTillStore()
  const activePromos = useTillStore(s => s.activePromos)
  // The bottle 5-for-4 button is revealed by a marker promo staff toggle on at
  // kickoff (and off after). Recomputed each render so it respects the marker's
  // date backstop without needing the page to reload.
  const bottleBundleEnabled = isBundleEnabled(activePromos, BOTTLE_BUNDLE_PROMO_NAME)
  const setMembersOnlyMode = useTillStore(s => s.setMembersOnlyMode)
  const membersOnlyMode = useTillStore(s => s.membersOnlyMode)
  const { isOnline } = useSyncStore()
  const { activeStaff } = useSessionStore()

  // Auto-clear event-wide members pricing on staff change so the next staff
  // member doesn't unknowingly inherit a previous shift's pricing mode.
  useEffect(() => {
    if (activeStaff) return
    // The log saw the mode go on; it must also see it go off by itself.
    if (useTillStore.getState().membersOnlyMode) {
      logEvent('pricing.members_only_mode_off', { reason: 'staff_signed_out' }, { severity: 1 })
    }
    setMembersOnlyMode(false)
  }, [activeStaff?.id, setMembersOnlyMode])

  useEffect(() => {
    fetchProducts().then(setProducts).catch(console.error).finally(() => setLoading(false))
    loadPromos(fetchActivePromotions)
    fetchPopularProductIds().then(setPopularIds)
  }, [])

  useEffect(() => {
    const area = gridAreaRef.current
    if (!area || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      // Columns match ProductGrid's breakpoints (grid-cols-2 / sm:3 / lg:4 / 2xl:5).
      const width = window.innerWidth
      const columns = width >= 1536 ? 5 : width >= 1024 ? 4 : width >= 640 ? 3 : 2
      const height = area.clientHeight - GRID_BOTTOM_PADDING
      const rows = Math.max(1, Math.floor((height + TILE_GAP) / (TILE_MIN_HEIGHT + TILE_GAP)))
      setGridCapacity(rows * columns)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(area)
    return () => observer.disconnect()
    // activeStaff: the grid area only exists once someone is signed in.
  }, [activeStaff?.id])

  // The Undo prompt clears itself a few seconds after the last tap.
  useEffect(() => {
    if (!undo) return
    const timer = setTimeout(() => setUndo(null), UNDO_MS)
    return () => clearTimeout(timer)
  }, [undo])

  // Flag a member's tab standing the moment they're put on the sale: a
  // toast (seen whichever panel is open) plus a note in the order panel.
  const activeMember = useTillStore(s => s.activeMember)
  const activeMemberId = activeMember?.id
  useEffect(() => {
    if (!activeMember) return
    const { addToast } = useToastStore.getState()
    if (activeMember.tab_blocked) {
      addToast(`${activeMember.name}'s tab is blocked — cash or card only`, 'error')
    }
    if (!(Number(activeMember.tab_balance) > 0)) return
    let cancelled = false
    fetchTabAges(activeMember.id)
      .then(ages => {
        const age = ages[activeMember.id]
        // Ignore a late answer for a member who has since been cleared.
        if (cancelled || !age || useTillStore.getState().activeMember?.id !== activeMember.id) return
        useTillStore.getState().setActiveMemberTab(age)
        if (age.overdue) {
          addToast(`${activeMember.name} hasn't paid their tab for ${age.days} days`, 'error')
        }
      })
      .catch(err => console.error('Failed to load tab age:', err))
    return () => { cancelled = true }
    // Keyed on the id only: the member object is replaced on every lookup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMemberId])

  // Look up what this member usually orders, to offer it in one tap.
  useEffect(() => {
    setUsual([])
    if (!activeMemberId) return
    let cancelled = false
    fetchMemberUsual(activeMemberId).then(result => { if (!cancelled) setUsual(result) })
    return () => { cancelled = true }
  }, [activeMemberId])

  // Auto-close mobile order sheet after checkout clears the cart
  useEffect(() => {
    if (orderItems.length === 0) setShowMobileOrder(false)
  }, [orderItems.length])

  const handleCheckout = useCallback(async (paymentMethod) => {
    const total = useTillStore.getState().getTotal()
    const currentItems = useTillStore.getState().orderItems
    const currentMember = useTillStore.getState().activeMember

    // Blocked tabs take cash or card only. The member on the order may have
    // been looked up before another till blocked them, so re-check live.
    if (paymentMethod === 'tab' && currentMember) {
      const blocked = currentMember.tab_blocked || (isOnline && await isTabBlocked(currentMember.id))
      if (blocked) {
        useTillStore.setState({ activeMember: { ...currentMember, tab_blocked: true } })
        useToastStore.getState().addToast(`${currentMember.name}'s tab is blocked — take cash or card`, 'error')
        // Nothing is written to the database for a refused sale, so this is
        // the only record that someone tried to put drinks on a blocked tab.
        logEvent('tab.sale_refused_blocked', {
          member_id: currentMember.id, member_name: currentMember.name, total: Number(total.toFixed(2)),
        }, { severity: 1 })
        return
      }
    }

    const order = {
      // Client-generated id: the create_order_with_items RPC upserts on it,
      // so an offline order replayed by sync can never duplicate.
      id: newOrderId(),
      member_id: currentMember?.id ?? null,
      // Who rang it: the staff member signed in at this till right now.
      staff_id: useSessionStore.getState().activeStaff?.id ?? null,
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

    // printed: a receipt actually went to the printer (with no printer IP
    // the job is silently skipped, and so is the drawer kick).
    let printed = false
    try {
      await printReceipt({ orderId: order.id, total, paymentMethod, createdAt: order.created_at })
      printed = !!getPrinterIp()
    } catch (err) {
      console.error('Print failed:', err)
      useToastStore.getState().addToast('Print failed — check printer connection', 'error')
      logEvent('receipt.print_failed', { what: 'receipt', message: String(err?.message ?? err).slice(0, 300), order_id: order.id }, { severity: 1 })
    }

    // Kept for the "Sale complete" note and the "Same again" button.
    useTillStore.getState().setLastSale({ items: currentItems, member: currentMember, total, paymentMethod })
    setUndo(null)
    clearOrder()

    // Logged last, once the till is ready for the next customer. The order
    // row says what was sold; this says how the sale ended up (stored online,
    // queued on this till, or not stored at all) and whether a receipt came
    // out. A sale that could not be stored anywhere has no row and never
    // will, so its lines travel with the event.
    logEvent('sale.completed', {
      order_id: order.id,
      total: Number(total.toFixed(2)),
      method: paymentMethod,
      lines: items.length,
      saved,
      printed,
      ...(saved === 'failed'
        ? { member_id: order.member_id, items: items.slice(0, 40).map(i => ({ product_id: i.product_id, quantity: i.quantity, unit_price: i.unit_price })) }
        : {}),
    }, { severity: saved === 'failed' ? 2 : saved === 'online' ? 0 : 1 })
  }, [isOnline, clearOrder])

  if (!activeStaff) { return <PinLoginScreen /> }

  const CATEGORY_ORDER = ['draught', 'bottle', 'spirit', 'soft', 'food', 'other']
  const sorted = [...products].sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category))
  // Popular needs sales history; without any, the till opens on All instead.
  const showPopular = sorted.some(p => popularIds.includes(p.id))
  const activeCategory = category === 'popular' && !showPopular ? 'all' : category
  // Deals take the first tiles; the best sellers fill what is left of one screen.
  const dealCount = 1 + (bottleBundleEnabled ? 1 : 0)
  const onSale = popularIds.filter(id => sorted.some(p => p.id === id))
  const popularFit = gridCapacity ? onSale.slice(0, Math.max(1, gridCapacity - dealCount)) : onSale
  const filtered = activeCategory === 'all'
    ? sorted
    : activeCategory === 'popular'
      ? sorted.filter(p => popularFit.includes(p.id))
      : sorted.filter(p => p.category === activeCategory)

  // Bundle deals sit in the grid as tiles, ahead of the products.
  const deals = [
    { key: 'shots', name: '4 Shots for £10', price: '£10.00', category: 'spirit', onClick: () => setShowShotBundle(true) },
    bottleBundleEnabled && {
      key: 'bottles', name: '5 for 4 Bottles', price: 'Cheapest free', category: 'bottle', onClick: () => setShowBottleBundle(true),
    },
  ].filter(deal => deal && ['popular', 'all', deal.category].includes(activeCategory))

  const actions = [
    { label: 'One for staff', Icon: Beer, onClick: () => setShowOneForStaff(true) },
    { label: 'Staff drink', Icon: GlassWater, onClick: () => setShowStaffDrink(true) },
    { label: 'Wastage', Icon: Trash2, onClick: () => setShowWastage(true) },
    { label: 'Cashback', Icon: Banknote, onClick: () => setShowCashback(true) },
    { label: 'Prize win', Icon: Trophy, onClick: () => setShowPrizeWin(true) },
    { label: 'Sign in guest', Icon: UserPlus, onClick: () => setShowGuestSignIn(true) },
    { label: 'Fix payment', Icon: RotateCcw, onClick: () => { setShowRecentSales(true); logEvent('sales.recent_viewed') } },
  ]

  const usualLines = usual
    .map(u => ({ product: products.find(p => p.id === u.product_id), quantity: u.quantity }))
    .filter(u => u.product)

  function handleAddUsual() {
    const { addItem, addBundleItems, addBottleBundle } = useTillStore.getState()
    // The usual gets the same deals the member would get ordering it at the
    // bar: four eligible shots go on as 4-for-£10, not four single shots.
    const plan = planUsual(usualLines, {
      isShot: isShotBundleEligible,
      isBottle: isBottleBundleEligible,
      shotSize: SHOT_BUNDLE_QTY,
      bottleDealOn: bottleBundleEnabled,
    })
    for (const bundle of plan.shotBundles) addBundleItems(bundle, SHOT_BUNDLE_TOTAL)
    for (const bundle of plan.bottleBundles) addBottleBundle(bundle)
    for (const { product, quantity } of plan.singles) {
      for (let n = 0; n < quantity; n++) addItem(product)
    }
    setUsual([])
    setUndo(null)
  }

  function handleUndo() {
    useTillStore.getState().removeOne(undo.id)
    // Taking back the tile just tapped is still a drink coming off an order
    // before payment, so it is recorded like the minus button is.
    logEvent('cart.item_undone', { product: undo.name, product_id: undo.id })
    setUndo(null)
  }

  function handleSameAgain() {
    const { lastSale, repeatLastSale } = useTillStore.getState()
    repeatLastSale(products)
    // The member on the last sale is a snapshot from before it was paid —
    // refresh them so the tab balance and any block are current.
    const member = lastSale?.member
    if (member?.membership_number && isOnline) {
      findMemberByNumber(member.membership_number)
        .then(fresh => {
          if (fresh && useTillStore.getState().activeMember?.id === fresh.id) {
            useTillStore.setState({ activeMember: fresh })
          }
        })
        .catch(err => console.error('Failed to refresh member:', err))
    }
  }

  const orderPanelProps = {
    onCheckout: handleCheckout,
    products,
    usual: usualLines,
    onAddUsual: handleAddUsual,
    onSameAgain: handleSameAgain,
    onFixPayment: () => { setShowRecentSales(true); logEvent('sales.recent_viewed') },
    // On tablet and up the Undo prompt lives in the order panel, so it never
    // covers a tile; phones (no side panel) get a floating one instead.
    undo,
    onUndo: handleUndo,
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="relative flex-1 min-w-0 flex flex-col overflow-hidden">
        <div className="flex flex-wrap items-start gap-3 px-4 md:px-6 pt-4 pb-3">
          {!activeMember && (
            <div className="flex-1 min-w-[240px]">
              <MemberLookup />
            </div>
          )}
          <div className={membersOnlyMode ? 'w-full order-first' : activeMember ? '' : 'shrink-0'}>
            <MembersOnlyToggle />
          </div>
        </div>
        <div className="px-4 md:px-6 pb-3">
          <CategoryFilter active={activeCategory} onChange={setCategory} showPopular={showPopular} />
        </div>
        <div ref={gridAreaRef} className="flex-1 min-h-0 overflow-auto scrollbar-hide px-4 md:px-6 pb-3">
          {loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-2.5">
              {Array.from({ length: 12 }).map((_, i) => (
                <div
                  key={i}
                  className="bg-slate-800 rounded-2xl min-h-[100px] animate-pulse motion-reduce:animate-none"
                />
              ))}
            </div>
          ) : filtered.length === 0 && deals.length === 0 ? (
            <div className="text-slate-400 text-sm">No products in this category</div>
          ) : (
            <ProductGrid
              products={filtered}
              deals={deals}
              onAdded={product => setUndo({ id: product.id, name: product.name })}
            />
          )}
        </div>

        {undo && (
          <div
            role="status"
            className="md:hidden absolute left-1/2 -translate-x-1/2 bottom-[152px] z-20 flex items-center gap-3
              pl-5 pr-1.5 py-1.5 rounded-2xl bg-slate-100 text-[#121314] shadow-2xl whitespace-nowrap"
          >
            <span className="text-base font-bold">Added {undo.name}</span>
            <button
              onClick={handleUndo}
              className="min-h-[48px] px-5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-base
                font-extrabold cursor-pointer transition-colors"
            >
              Undo
            </button>
          </div>
        )}

        <div className="flex gap-2 px-4 md:px-6 py-3 border-t border-slate-800 overflow-x-auto scrollbar-hide">
          {actions.map(({ label, Icon, onClick }) => (
            <button
              key={label}
              onClick={onClick}
              className="flex-1 min-w-[92px] min-h-[60px] rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100
                text-[13px] font-semibold flex flex-col items-center justify-center gap-1 whitespace-nowrap
                cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
            >
              <Icon size={20} className="text-blue-300" aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="hidden md:flex">
        <OrderPanel {...orderPanelProps} />
      </div>

      {/* Mobile: floating order button */}
      {orderItems.length > 0 && (
        <button
          onClick={() => setShowMobileOrder(true)}
          aria-label={`View order — ${orderItems.length} item${orderItems.length > 1 ? 's' : ''}, £${getTotal().toFixed(2)}`}
          className="md:hidden fixed bottom-[168px] right-4 z-30 flex items-center gap-2
            bg-blue-600 hover:bg-blue-500 active:scale-95 text-white font-semibold
            px-4 py-3 rounded-2xl shadow-xl transition-all duration-150 cursor-pointer
            focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-[#121314]"
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
            <OrderPanel {...orderPanelProps} onClose={() => setShowMobileOrder(false)} />
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
            // The credit itself is a row once the sale is paid; the line can
            // still be taken off before then, so note who it was rung for.
            const self = staffMember.id === useSessionStore.getState().activeStaff?.id
            logEvent('cart.staff_credit_added', {
              product: product.name, for_staff_id: staffMember.id, for_staff_name: staffMember.name, self_award: self,
            }, { severity: self ? 1 : 0 })
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
      {showBottleBundle && (
        <BottleBundleModal
          products={products}
          onClose={() => setShowBottleBundle(false)}
        />
      )}
      {showRecentSales && (
        <RecentSalesModal onClose={() => setShowRecentSales(false)} />
      )}
      {showGuestSignIn && (
        <GuestSignInModal
          initialMember={useTillStore.getState().activeMember}
          onClose={() => setShowGuestSignIn(false)}
          onSaved={() => setShowGuestSignIn(false)}
        />
      )}
    </div>
  )
}
