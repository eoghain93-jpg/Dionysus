// src/pages/TabsPage.jsx
import { useState, useEffect, useCallback } from 'react'
import { ChevronRight, AlertTriangle, Clock, Lock } from '../lib/icons'
import { fetchOpenTabs, fetchTabOrders, setTabBlocked, TAB_OVERDUE_DAYS } from '../lib/tabs'
import { useSessionStore } from '../stores/sessionStore'
import { useTabAlertStore } from '../stores/tabAlertStore'
import SettleTabModal from '../components/members/SettleTabModal'
import AdjustTabModal from '../components/members/AdjustTabModal'
import { removeOrderFromTab } from '../lib/tabs'
import { printTabsList, printTabStatement } from '../lib/starPrinter'
import { useToastStore } from '../hooks/useToast'
import BlurredAmount from '../components/ui/BlurredAmount'

export default function TabsPage() {
  const [tabs, setTabs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [expandedId, setExpandedId] = useState(null)
  const [expandedOrders, setExpandedOrders] = useState({})
  const [expandedLoading, setExpandedLoading] = useState({})
  const [settlingMember, setSettlingMember] = useState(null)
  const [adjustingMember, setAdjustingMember] = useState(null)
  const [removingOrderId, setRemovingOrderId] = useState(null)
  const [printing, setPrinting] = useState(false)
  const [printingStatementId, setPrintingStatementId] = useState(null)
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [blockingId, setBlockingId] = useState(null)
  const { activeStaff } = useSessionStore()

  const loadTabs = useCallback(() => {
    setLoading(true)
    setError(null)
    fetchOpenTabs()
      .then(setTabs)
      .catch(err => {
        console.error(err)
        setError('Failed to load tabs. Please try again.')
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { loadTabs() }, [loadTabs])

  function toggleExpand(id) {
    const isCurrentlyExpanded = expandedId === id
    const next = isCurrentlyExpanded ? null : id
    setExpandedId(next)
    // Always refetch on expand: a cached list goes stale when the tab is
    // settled or changed on the other till.
    if (next) {
      setExpandedLoading(l => ({ ...l, [id]: true }))
      fetchTabOrders(id)
        .then(orders => setExpandedOrders(o => ({ ...o, [id]: orders })))
        .catch(err => {
          console.error(err)
          setExpandedOrders(o => ({ ...o, [id]: { fetchError: true } }))
        })
        .finally(() => setExpandedLoading(l => ({ ...l, [id]: false })))
    }
  }

  function handleSettled(memberId, amountPaid) {
    setSettlingMember(null)
    // A settle can be partial, so decrement rather than assume the tab is
    // cleared; only drop the row once the balance reaches zero (same
    // pattern as handleAdjusted).
    setTabs(prev => prev.map(m =>
      m.id === memberId
        ? { ...m, tab_balance: Math.max(0, Number(m.tab_balance) - amountPaid) }
        : m
    ).filter(m => Number(m.tab_balance) > 0))
  }

  function handleAdjusted(member, delta) {
    setAdjustingMember(null)
    setTabs(prev => prev.map(m =>
      m.id === member.id
        ? { ...m, tab_balance: Math.max(0, Number(m.tab_balance) + delta) }
        : m
    ).filter(m => Number(m.tab_balance) > 0))
  }

  async function handleRemoveOrder(order, member) {
    setRemovingOrderId(order.id)
    try {
      await removeOrderFromTab(order.id, member.id, order.total_amount)
      setExpandedOrders(prev => ({
        ...prev,
        [member.id]: prev[member.id].filter(o => o.id !== order.id),
      }))
      setTabs(prev => prev.map(m =>
        m.id === member.id
          ? { ...m, tab_balance: Math.max(0, Number(m.tab_balance) - order.total_amount) }
          : m
      ).filter(m => Number(m.tab_balance) > 0))
    } catch (err) {
      console.error('Failed to remove order:', err)
      // Previously silent — staff had no idea a removal failed. Most likely
      // cause is a stale view (tab settled on another till), so reload.
      useToastStore.getState().addToast(err?.message ?? 'Could not remove that drink', 'error')
      setExpandedOrders({})
      setExpandedId(null)
      loadTabs()
    } finally {
      setRemovingOrderId(null)
    }
  }

  async function handleToggleBlock(member) {
    const blocked = !member.tab_blocked
    setBlockingId(member.id)
    try {
      await setTabBlocked(member.id, blocked, activeStaff?.id)
      setTabs(prev => prev.map(m => m.id === member.id ? { ...m, tab_blocked: blocked } : m))
      useToastStore.getState().addToast(
        blocked
          ? `${member.name} can't put drinks on their tab until it's unblocked`
          : `${member.name} can use their tab again`,
        'success'
      )
    } catch (err) {
      console.error('Failed to update tab block:', err)
      useToastStore.getState().addToast('Could not update the tab block — try again', 'error')
    } finally {
      setBlockingId(null)
    }
  }

  async function handlePrint() {
    setPrinting(true)
    try {
      await printTabsList(tabs)
    } catch (err) {
      console.error('Print failed:', err)
      useToastStore.getState().addToast('Print failed — check printer connection', 'error')
    } finally {
      setPrinting(false)
    }
  }

  async function handlePrintStatement(member) {
    setPrintingStatementId(member.id)
    try {
      // Re-fetch rather than reuse the expanded rows so the statement always
      // reflects the live tab, even if an order was removed on another till.
      const orders = await fetchTabOrders(member.id)
      await printTabStatement({ member, orders })
    } catch (err) {
      console.error('Print failed:', err)
      useToastStore.getState().addToast('Print failed — check printer connection', 'error')
    } finally {
      setPrintingStatementId(null)
    }
  }

  const total = tabs.reduce((sum, m) => sum + Number(m.tab_balance), 0)
  const overdueTabs = tabs.filter(m => m.overdue)
  const overdueTotal = overdueTabs.reduce((sum, m) => sum + Number(m.tab_balance), 0)
  // Fall back to the full list if the last overdue tab was just settled.
  const showOverdueOnly = overdueOnly && overdueTabs.length > 0
  const visibleTabs = showOverdueOnly ? overdueTabs : tabs

  // Keep the nav badge in step with what this page shows (settles and
  // adjustments here change the count without a refetch).
  const overdueCount = overdueTabs.length
  useEffect(() => {
    if (!loading && !error) useTabAlertStore.getState().setOverdueCount(overdueCount)
  }, [overdueCount, loading, error])

  return (
    <div className="ui-page">
      {/* Header */}
      <div className="ui-page-header">
        <h1 className="ui-title">Tabs</h1>
        {tabs.length > 0 && (
          <div className="flex items-center justify-between gap-4 w-full sm:w-auto">
            <div className="sm:text-right">
              <p className="ui-stat-label">Total outstanding</p>
              <BlurredAmount className="text-white text-[28px] leading-tight font-extrabold tracking-tight">
                £{total.toFixed(2)}
              </BlurredAmount>
            </div>
            <button
              onClick={handlePrint}
              disabled={printing}
              aria-label="Print tabs"
              className="ui-btn ui-btn-secondary shrink-0 min-w-[96px]"
            >
              {printing ? 'Printing…' : 'Print'}
            </button>
          </div>
        )}
      </div>

      {/* Overdue alert */}
      {overdueTabs.length > 0 && (
        <div role="status" className="ui-banner ui-banner-warn justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <AlertTriangle size={24} className="text-amber-300 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-amber-100 text-base font-bold">
                {overdueTabs.length} {overdueTabs.length === 1 ? 'tab has' : 'tabs have'} had no payment for {TAB_OVERDUE_DAYS}+ days
              </p>
              <p className="text-amber-200 text-[15px] flex items-center gap-1.5 flex-wrap">
                <span>Owed on overdue tabs:</span>
                <BlurredAmount className="text-amber-100 font-bold">£{overdueTotal.toFixed(2)}</BlurredAmount>
              </p>
            </div>
          </div>
          <button
            onClick={() => setOverdueOnly(v => !v)}
            aria-pressed={showOverdueOnly}
            className="ui-btn ui-btn-warn shrink-0 w-full sm:w-auto"
          >
            {showOverdueOnly ? 'Show all tabs' : 'Show overdue only'}
          </button>
        </div>
      )}

      {/* Content */}
      <div className="ui-card flex-1 min-h-[160px] overflow-auto">
        {loading ? (
          <p className="ui-empty">Loading open tabs…</p>
        ) : error ? (
          <p className="text-red-300 text-base font-semibold text-center py-10 px-4">{error}</p>
        ) : tabs.length === 0 ? (
          <p className="ui-empty">No open tabs.</p>
        ) : (
          <ul className="divide-y divide-slate-800">
            {visibleTabs.map(member => {
              const isExpanded = expandedId === member.id
              const orders = expandedOrders[member.id]
              const ordersLoading = expandedLoading[member.id]
              return (
                <li key={member.id} className={isExpanded ? 'bg-[#1D1F22]' : ''}>
                  {/* Row */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                    <button
                      onClick={() => toggleExpand(member.id)}
                      className="flex-1 basis-56 min-w-0 min-h-[56px] flex items-center gap-3 text-left rounded-xl cursor-pointer
                        focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                      aria-expanded={isExpanded}
                    >
                      <ChevronRight
                        size={22}
                        className={`text-slate-400 shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                        aria-hidden="true"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-lg leading-snug font-bold truncate">{member.name}</p>
                        <p className="text-slate-400 text-[15px]">{member.membership_number}</p>
                        {(member.overdue || member.tab_blocked) && (
                          <div className="flex flex-wrap gap-1.5 mt-1.5">
                            {member.overdue && (
                              <span className="ui-tag ui-tag-warn">
                                <Clock size={14} aria-hidden="true" />
                                No payment for {member.days} days
                              </span>
                            )}
                            {member.tab_blocked && (
                              <span className="ui-tag ui-tag-bad">
                                <Lock size={14} aria-hidden="true" />
                                Tab blocked
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </button>
                    <div className="flex items-center justify-between gap-4 w-full sm:w-auto pl-[34px] sm:pl-0">
                      <BlurredAmount className="text-white text-[22px] font-extrabold shrink-0 min-h-[48px] sm:min-w-[96px] sm:text-right">
                        £{Number(member.tab_balance).toFixed(2)}
                      </BlurredAmount>
                      <button
                        onClick={() => setSettlingMember(member)}
                        aria-label={`Settle tab for ${member.name}`}
                        className="ui-btn ui-btn-pay ui-btn-lg shrink-0 min-w-[120px]"
                      >
                        Settle
                      </button>
                    </div>
                  </div>

                  {/* Expanded order breakdown */}
                  {isExpanded && (
                    <div className="px-4 pb-4 flex flex-col gap-3">
                      <div className="flex items-center justify-end gap-2 flex-wrap">
                        <p className="text-slate-300 text-[15px] mr-auto">
                          {member.last_paid_at
                            ? `Last payment ${new Date(member.last_paid_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
                            : 'No payments recorded'}
                        </p>
                        <button
                          onClick={() => handleToggleBlock(member)}
                          disabled={blockingId === member.id}
                          aria-label={`${member.tab_blocked ? 'Unblock' : 'Block'} tab for ${member.name}`}
                          className={`ui-btn shrink-0 ${member.tab_blocked ? 'ui-btn-secondary' : 'ui-btn-danger'}`}
                        >
                          {member.tab_blocked ? 'Unblock tab' : 'Block tab'}
                        </button>
                        <button
                          onClick={() => handlePrintStatement(member)}
                          disabled={printingStatementId === member.id}
                          aria-label={`Print tab statement for ${member.name}`}
                          className="ui-btn ui-btn-secondary shrink-0"
                        >
                          {printingStatementId === member.id ? 'Printing…' : 'Print'}
                        </button>
                        <button
                          onClick={() => setAdjustingMember(member)}
                          aria-label={`Adjust tab for ${member.name}`}
                          className="ui-btn ui-btn-secondary shrink-0"
                        >
                          Adjust
                        </button>
                      </div>
                      {ordersLoading ? (
                        <p className="text-slate-400 text-[15px]">Loading orders…</p>
                      ) : orders?.fetchError ? (
                        <p className="ui-error text-[15px]">Failed to load orders. Please try again.</p>
                      ) : !orders?.length ? (
                        <p className="text-slate-400 text-[15px]">No tab orders found.</p>
                      ) : (
                        orders.map(order => (
                          <div key={order.id} className="bg-slate-800 rounded-xl pl-4 pr-2 py-2">
                            <div className="flex items-center justify-between gap-3 min-h-[48px]">
                              <p className="text-slate-300 text-[15px]">
                                {new Date(order.created_at).toLocaleString('en-GB', {
                                  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                                })}
                                <span className="text-white text-base font-extrabold ml-3">£{Number(order.total_amount).toFixed(2)}</span>
                              </p>
                              {removingOrderId === order.id ? (
                                <span className="text-slate-400 text-[15px] px-3">Removing…</span>
                              ) : (
                                <button
                                  onClick={() => handleRemoveOrder(order, member)}
                                  aria-label="Remove order from tab"
                                  className="ui-btn ui-btn-danger shrink-0"
                                >
                                  Remove
                                </button>
                              )}
                            </div>
                            <ul className="flex flex-col gap-1 pr-2 pb-1.5 mt-1">
                              {order.order_items.map(item => (
                                <li key={item.id} className="flex justify-between gap-3 text-[15px] text-slate-100">
                                  <span>
                                    <span>{item.products?.name ?? 'Unknown'}</span>
                                    {' × '}
                                    <span>{item.quantity}</span>
                                  </span>
                                  <span>£{(item.unit_price * item.quantity).toFixed(2)}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Settle modal */}
      {settlingMember && (
        <SettleTabModal
          member={settlingMember}
          onClose={() => setSettlingMember(null)}
          onSettled={amountPaid => { const id = settlingMember.id; handleSettled(id, amountPaid) }}
        />
      )}

      {/* Adjust modal */}
      {adjustingMember && (
        <AdjustTabModal
          member={adjustingMember}
          onClose={() => setAdjustingMember(null)}
          onAdjusted={(delta) => handleAdjusted(adjustingMember, delta)}
        />
      )}
    </div>
  )
}
