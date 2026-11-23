import { useState, useEffect, useRef, useId } from 'react'
import { X, Clock, Phone, Mail, Calendar, Star, CreditCard, KeyRound, Edit2, Lock } from '../../lib/icons'
import { supabase } from '../../lib/supabase'
import { setTabBlocked } from '../../lib/tabs'
import { useSessionStore } from '../../stores/sessionStore'
import { useToastStore } from '../../hooks/useToast'
import { useCanUnblockTabs } from '../../hooks/useCanUnblockTabs'
import SettleTabModal from './SettleTabModal'
import AdjustTabModal from './AdjustTabModal'
import SetPinModal from './SetPinModal'
import { isRenewalDueSoon } from './MemberList'
import BlurredAmount from '../ui/BlurredAmount'
import { logEvent } from '../../lib/audit/log'

/**
 * Full member profile overlay/panel.
 * Props:
 *   member       — member object
 *   onClose      — called to close this panel
 *   onEdit       — called with member to open edit form
 *   onSettleTab  — called after tab settled or adjusted (to refresh parent)
 */
export default function MemberProfile({ member, onClose, onEdit, onSettleTab }) {
  const titleId = useId()
  const closeRef = useRef(null)
  const overlayRef = useRef(null)

  const [orders, setOrders] = useState([])
  const [loadingOrders, setLoadingOrders] = useState(true)
  const [settleModalOpen, setSettleModalOpen] = useState(false)
  const [setPinOpen, setSetPinOpen] = useState(false)
  const [adjustModalOpen, setAdjustModalOpen] = useState(false)
  const [tabBlocked, setTabBlockedState] = useState(!!member.tab_blocked)
  const [savingBlock, setSavingBlock] = useState(false)
  const { activeStaff } = useSessionStore()
  const canUnblock = useCanUnblockTabs(activeStaff?.id)

  useEffect(() => { setTabBlockedState(!!member.tab_blocked) }, [member.id, member.tab_blocked])

  async function handleToggleBlock() {
    const blocked = !tabBlocked
    setSavingBlock(true)
    try {
      await setTabBlocked(member.id, blocked, activeStaff?.id)
      setTabBlockedState(blocked)
      onSettleTab()
    } catch (err) {
      console.error('Failed to update tab block:', err)
      useToastStore.getState().addToast(
        err?.code === '42501' ? 'Only Admin or Nikki can unblock a tab' : 'Could not update the tab block — try again',
        'error'
      )
    } finally {
      setSavingBlock(false)
    }
  }

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

  const fieldLabel = 'text-slate-400 text-sm font-semibold mb-0.5 flex items-center gap-1.5'

  return (
    <div
      ref={overlayRef}
      className="ui-modal-backdrop"
      onClick={handleOverlayClick}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="ui-modal max-w-xl p-0 gap-0 overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 pl-6 pr-4 py-4 border-b border-slate-800">
          <h2
            id={titleId}
            className="ui-modal-title text-[26px] min-w-0 break-words"
          >
            {member.name}
          </h2>
          <button
            ref={closeRef}
            onClick={onClose}
            aria-label="Close profile"
            className="ui-btn ui-btn-ghost ui-btn-icon shrink-0"
          >
            <X size={22} aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 flex flex-col gap-5 overflow-y-auto min-h-0 flex-1">
          {/* Core details */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-4 text-base">
            <div>
              <p className={fieldLabel}>Membership No.</p>
              <p className="text-white font-bold">{member.membership_number}</p>
            </div>
            <div>
              <p className={fieldLabel}>
                <Star size={14} aria-hidden="true" /> Tier
              </p>
              <p className="text-white font-bold capitalize">{member.membership_tier ?? 'member'}</p>
            </div>

            {member.phone && (
              <div>
                <p className={fieldLabel}>
                  <Phone size={14} aria-hidden="true" /> Phone
                </p>
                <p className="text-white">{member.phone}</p>
              </div>
            )}

            {member.email && (
              <div>
                <p className={fieldLabel}>
                  <Mail size={14} aria-hidden="true" /> Email
                </p>
                <p className="text-white break-all">{member.email}</p>
              </div>
            )}

            <div>
              <p className={fieldLabel}>
                <Calendar size={14} aria-hidden="true" /> Renewal Date
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-white">{formatDate(member.renewal_date)}</p>
                {renewalSoon && (
                  <span className="ui-tag ui-tag-warn" aria-label="Renewal due soon">
                    <Clock size={14} aria-hidden="true" />
                    <span>Renewal due</span>
                  </span>
                )}
              </div>
            </div>

            <div>
              <p className={fieldLabel}>Tab Balance</p>
              {hasTab ? (
                <span
                  className="contents"
                  onClickCapture={() => logEvent('tab.amount_revealed', { member_id: member.id })}
                >
                  <BlurredAmount className="text-blue-300 text-[22px] leading-tight font-extrabold">
                    {formatCurrency(member.tab_balance)}
                  </BlurredAmount>
                </span>
              ) : (
                <p className="text-slate-400">None</p>
              )}
              {tabBlocked && (
                <p className="text-red-300 text-sm font-semibold mt-1 flex items-center gap-1.5">
                  <Lock size={14} className="shrink-0" aria-hidden="true" />
                  Tab blocked — cash or card only
                </p>
              )}
            </div>
          </div>

          {/* Favourite drinks */}
          {favouriteDrinks.length > 0 && (
            <div>
              <p className={`${fieldLabel} mb-1.5`}>Favourite Drinks</p>
              <div className="flex flex-wrap gap-2">
                {favouriteDrinks.map((drink, i) => (
                  <span key={i} className="ui-tag ui-tag-neutral text-slate-100">
                    {drink}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          {member.notes && (
            <div>
              <p className={fieldLabel}>Notes</p>
              <p className="text-white text-base">{member.notes}</p>
            </div>
          )}

          {/* Spend history */}
          <div>
            <h3 className="ui-section-title mb-2">
              Recent Purchases
            </h3>
            {loadingOrders ? (
              <p className="text-slate-400 text-[15px]">Loading…</p>
            ) : orders.length === 0 ? (
              <p className="text-slate-400 text-[15px]">No purchases recorded.</p>
            ) : (
              <ul className="flex flex-col" role="list">
                {orders.map(order => (
                  <li
                    key={order.id}
                    className="grid grid-cols-[1fr_auto_5.5rem] items-center gap-3 text-[15px] py-2.5 border-b border-slate-800 last:border-b-0"
                  >
                    <span className="text-slate-300">{formatDate(order.created_at)}</span>
                    <span className="text-slate-300 capitalize">{order.payment_method ?? '—'}</span>
                    <span className="text-white font-bold text-right">{formatCurrency(order.total_amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex flex-wrap gap-3 px-6 py-4 border-t border-slate-800">
          {hasTab && (
            <button
              onClick={() => setSettleModalOpen(true)}
              className="ui-btn ui-btn-pay"
            >
              <CreditCard size={18} aria-hidden="true" />
              Settle Tab
            </button>
          )}
          {/* Always available — the Tabs page only lists members who already
              owe something, so this is the only way to open a tab from £0. */}
          <button
            onClick={() => setAdjustModalOpen(true)}
            className="ui-btn ui-btn-secondary"
          >
            <Edit2 size={18} aria-hidden="true" />
            Adjust Tab
          </button>
          {!(tabBlocked && !canUnblock) && (
          <button
            onClick={handleToggleBlock}
            disabled={savingBlock}
            className={`ui-btn ${tabBlocked ? 'ui-btn-secondary' : 'ui-btn-danger'}`}
          >
            <Lock size={18} aria-hidden="true" />
            {tabBlocked ? 'Unblock Tab' : 'Block Tab'}
          </button>
          )}
          {member.membership_tier === 'staff' && (
            <button
              onClick={() => setSetPinOpen(true)}
              className="ui-btn ui-btn-secondary"
            >
              <KeyRound size={18} aria-hidden="true" />
              Set PIN
            </button>
          )}
          <button
            onClick={() => onEdit(member)}
            className="ui-btn ui-btn-ghost flex-1"
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

      {/* Adjust tab modal */}
      {adjustModalOpen && (
        <AdjustTabModal
          member={member}
          onClose={() => setAdjustModalOpen(false)}
          onAdjusted={() => {
            setAdjustModalOpen(false)
            onSettleTab()
          }}
        />
      )}

      {/* Set PIN modal */}
      {setPinOpen && (
        <SetPinModal
          member={member}
          onClose={() => setSetPinOpen(false)}
          onSaved={() => setSetPinOpen(false)}
          requireCurrentPin
        />
      )}
    </div>
  )
}
