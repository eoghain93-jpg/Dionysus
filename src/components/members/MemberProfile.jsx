import { useState, useEffect, useRef, useId } from 'react'
import { X, Clock, Phone, Mail, Calendar, Star, CreditCard } from '../../lib/icons'
import { supabase } from '../../lib/supabase'
import SettleTabModal from './SettleTabModal'
import { isRenewalDueSoon } from './MemberList'

/**
 * Full member profile overlay/panel.
 * Props:
 *   member       — member object
 *   onClose      — called to close this panel
 *   onEdit       — called with member to open edit form
 *   onSettleTab  — called after tab settled (to refresh parent)
 */
export default function MemberProfile({ member, onClose, onEdit, onSettleTab }) {
  const titleId = useId()
  const closeRef = useRef(null)
  const overlayRef = useRef(null)

  const [orders, setOrders] = useState([])
  const [loadingOrders, setLoadingOrders] = useState(true)
  const [settleModalOpen, setSettleModalOpen] = useState(false)

  // Focus close button on mount
  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  // Escape to close
  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  // Click-outside to close (only on overlay backdrop itself)
  function handleOverlayClick(e) {
    if (e.target === overlayRef.current) onClose()
  }

  // Fetch spend history
  useEffect(() => {
    setLoadingOrders(true)
    supabase
      .from('orders')
      .select('id, created_at, total_amount, payment_method, status')
      .eq('member_id', member.id)
      .eq('status', 'paid')
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data }) => {
        setOrders(data ?? [])
      })
      .catch(() => setOrders([]))
      .finally(() => setLoadingOrders(false))
  }, [member.id])

  const renewalSoon = isRenewalDueSoon(member.renewal_date)
  const hasTab = member.tab_balance > 0

  function formatDate(dateStr) {
    if (!dateStr) return '—'
    return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  }

  function formatCurrency(amount) {
    return `£${Number(amount).toFixed(2)}`
  }

  const favouriteDrinks = Array.isArray(member.favourite_drinks)
    ? member.favourite_drinks
    : typeof member.favourite_drinks === 'string' && member.favourite_drinks.trim()
      ? member.favourite_drinks.split(',').map(d => d.trim()).filter(Boolean)
      : []

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 overflow-y-auto"
      onClick={handleOverlayClick}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-lg bg-[#0F172A] border border-slate-700 rounded-2xl shadow-xl flex flex-col my-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-slate-700">
          <h2
            id={titleId}
            className="text-lg font-bold text-white"
            style={{ fontFamily: "'Playfair Display SC', serif" }}
          >
            {member.name}
          </h2>
          <button
            ref={closeRef}
            onClick={onClose}
            aria-label="Close profile"
            className="text-slate-400 hover:text-white transition-colors cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-5 flex flex-col gap-5 overflow-y-auto max-h-[70vh]">
          {/* Core details */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-slate-400 text-xs mb-0.5">Membership No.</p>
              <p className="text-white font-medium">{member.membership_number}</p>
            </div>
            <div>
              <p className="text-slate-400 text-xs mb-0.5 flex items-center gap-1">
                <Star size={12} aria-hidden="true" /> Tier
              </p>
              <p className="text-white capitalize">{member.membership_tier ?? 'member'}</p>
            </div>

            {member.phone && (
              <div>
                <p className="text-slate-400 text-xs mb-0.5 flex items-center gap-1">
                  <Phone size={12} aria-hidden="true" /> Phone
                </p>
                <p className="text-white">{member.phone}</p>
              </div>
            )}

            {member.email && (
              <div>
                <p className="text-slate-400 text-xs mb-0.5 flex items-center gap-1">
                  <Mail size={12} aria-hidden="true" /> Email
                </p>
                <p className="text-white break-all">{member.email}</p>
              </div>
            )}

            <div>
              <p className="text-slate-400 text-xs mb-0.5 flex items-center gap-1">
                <Calendar size={12} aria-hidden="true" /> Renewal Date
              </p>
              <div className="flex items-center gap-2">
                <p className="text-white">{formatDate(member.renewal_date)}</p>
                {renewalSoon && (
                  <span className="inline-flex items-center gap-1 text-amber-400 text-xs" aria-label="Renewal due soon">
                    <Clock size={12} aria-hidden="true" />
                    <span>Renewal due</span>
                  </span>
                )}
              </div>
            </div>

            <div>
              <p className="text-slate-400 text-xs mb-0.5">Tab Balance</p>
              <p className={hasTab ? 'text-blue-400 font-medium' : 'text-slate-400'}>
                {hasTab ? formatCurrency(member.tab_balance) : 'None'}
              </p>
            </div>
          </div>

          {/* Favourite drinks */}
          {favouriteDrinks.length > 0 && (
            <div>
              <p className="text-slate-400 text-xs mb-1">Favourite Drinks</p>
              <div className="flex flex-wrap gap-2">
                {favouriteDrinks.map((drink, i) => (
                  <span key={i} className="px-2 py-0.5 rounded-full bg-slate-700 text-slate-200 text-xs">
                    {drink}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          {member.notes && (
            <div>
              <p className="text-slate-400 text-xs mb-1">Notes</p>
              <p className="text-white text-sm">{member.notes}</p>
            </div>
          )}

          {/* Spend history */}
          <div>
            <h3
              className="text-sm font-semibold text-slate-300 mb-2"
              style={{ fontFamily: "'Playfair Display SC', serif" }}
            >
              Recent Purchases
            </h3>
            {loadingOrders ? (
              <p className="text-slate-400 text-sm">Loading…</p>
            ) : orders.length === 0 ? (
              <p className="text-slate-400 text-sm">No purchases recorded.</p>
            ) : (
              <ul className="flex flex-col gap-1" role="list">
                {orders.map(order => (
                  <li key={order.id} className="flex items-center justify-between text-sm py-1 border-b border-slate-800">
                    <span className="text-slate-400">{formatDate(order.created_at)}</span>
                    <span className="text-slate-300 capitalize">{order.payment_method ?? '—'}</span>
                    <span className="text-white font-medium">{formatCurrency(order.total_amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex gap-3 px-5 pb-5 pt-3 border-t border-slate-700">
          {hasTab && (
            <button
              onClick={() => setSettleModalOpen(true)}
              className="flex items-center gap-2 px-4 min-h-[44px] rounded-xl bg-[#3B82F6] hover:bg-blue-400 text-white font-bold text-sm transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
            >
              <CreditCard size={16} aria-hidden="true" />
              Settle Tab
            </button>
          )}
          <button
            onClick={() => onEdit(member)}
            className="flex-1 min-h-[44px] rounded-xl border border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors cursor-pointer text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
          >
            Edit Member
          </button>
        </div>
      </div>

      {/* Settle tab modal */}
      {settleModalOpen && (
        <SettleTabModal
          member={member}
          onClose={() => setSettleModalOpen(false)}
          onSettled={() => {
            setSettleModalOpen(false)
            onSettleTab()
          }}
        />
      )}
    </div>
  )
}
