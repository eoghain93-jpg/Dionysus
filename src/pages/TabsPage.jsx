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
    <div className="flex flex-col h-full min-h-0 p-4 gap-4 overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1
          className="text-2xl font-bold text-white"
        >
          Tabs
        </h1>
        {tabs.length > 0 && (
          <div className="flex items-center gap-4">
            <button
              onClick={handlePrint}
              disabled={printing}
              aria-label="Print tabs"
              className="shrink-0 px-3 min-h-[36px] rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 font-bold text-xs transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-default focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
            >
              {printing ? 'Printing…' : 'Print'}
            </button>
            <div className="text-right">
              <p className="text-slate-400 text-xs">Total outstanding</p>
              <BlurredAmount className="text-white font-bold text-lg">
                £{total.toFixed(2)}
              </BlurredAmount>
            </div>
          </div>
        )}
      </div>

      {/* Overdue alert */}
      {overdueTabs.length > 0 && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 flex-wrap bg-amber-950 border border-amber-700 rounded-2xl px-4 py-3"
        >
          <div className="flex items-center gap-3 min-w-0">
            <AlertTriangle size={20} className="text-amber-400 shrink-0" aria-hidden="true" />
            <div>
              <p className="text-amber-100 text-sm font-semibold">
                {overdueTabs.length} {overdueTabs.length === 1 ? 'tab has' : 'tabs have'} had no payment for {TAB_OVERDUE_DAYS}+ days
              </p>
              <p className="text-amber-300 text-xs flex items-center gap-1">
                <span>Owed on overdue tabs:</span>
                <BlurredAmount className="text-amber-300">£{overdueTotal.toFixed(2)}</BlurredAmount>
              </p>
            </div>
          </div>
          <button
            onClick={() => setOverdueOnly(v => !v)}
            aria-pressed={showOverdueOnly}
            className="shrink-0 px-3 min-h-[36px] rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold text-xs transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
          >
            {showOverdueOnly ? 'Show all tabs' : 'Show overdue only'}
          </button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 bg-[#0F172A] rounded-2xl border border-slate-700 overflow-auto">
        {loading ? (
          <p className="text-slate-400 text-sm p-6 text-center">Loading open tabs…</p>
        ) : error ? (
          <p className="text-red-400 text-sm p-6 text-center">{error}</p>
        ) : tabs.length === 0 ? (
          <p className="text-slate-400 text-sm p-6 text-center">No open tabs.</p>
        ) : (
          <ul className="divide-y divide-slate-700">
            {visibleTabs.map(member => {
              const isExpanded = expandedId === member.id
              const orders = expandedOrders[member.id]
              const ordersLoading = expandedLoading[member.id]
              return (
                <li key={member.id}>
                  {/* Row */}
                  <div className="flex items-center gap-3 px-4 py-3">
                    <button
                      onClick={() => toggleExpand(member.id)}
                      className="flex-1 flex items-center gap-3 text-left focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
                      aria-expanded={isExpanded}
                    >
                      <ChevronRight
                        size={16}
                        className={`text-slate-500 shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                        aria-hidden="true"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-medium truncate">{member.name}</p>
                        <p className="text-slate-400 text-xs">{member.membership_number}</p>
                        {(member.overdue || member.tab_blocked) && (
                          <div className="flex flex-wrap gap-1.5 mt-1">
                            {member.overdue && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-950 border border-amber-700 text-amber-300 text-xs font-medium">
                                <Clock size={12} aria-hidden="true" />
                                No payment for {member.days} days
                              </span>
                            )}
                            {member.tab_blocked && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-950 border border-red-800 text-red-300 text-xs font-medium">
                                <Lock size={12} aria-hidden="true" />
                                Tab blocked
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </button>
                    <BlurredAmount className="text-white font-bold text-sm shrink-0">
                      £{Number(member.tab_balance).toFixed(2)}
                    </BlurredAmount>
                    <button
                      onClick={() => setSettlingMember(member)}
                      aria-label={`Settle tab for ${member.name}`}
                      className="shrink-0 px-3 min-h-[36px] rounded-lg bg-[#22C55E] hover:bg-green-400 text-slate-900 font-bold text-xs transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
                    >
                      Settle
                    </button>
                  </div>

                  {/* Expanded order breakdown */}
                  {isExpanded && (
                    <div className="px-4 pb-3 flex flex-col gap-2">
                      <div className="flex items-center justify-end gap-2 flex-wrap">
                        <p className="text-slate-400 text-xs mr-auto">
                          {member.last_paid_at
                            ? `Last payment ${new Date(member.last_paid_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
                            : 'No payments recorded'}
                        </p>
                        <button
                          onClick={() => handleToggleBlock(member)}
                          disabled={blockingId === member.id}
                          aria-label={`${member.tab_blocked ? 'Unblock' : 'Block'} tab for ${member.name}`}
                          className={`shrink-0 px-3 min-h-[36px] rounded-lg font-bold text-xs transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-default focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617] ${
                            member.tab_blocked
                              ? 'bg-slate-700 hover:bg-slate-600 text-slate-300'
                              : 'bg-red-900 hover:bg-red-800 text-red-100'
                          }`}
                        >
                          {member.tab_blocked ? 'Unblock tab' : 'Block tab'}
                        </button>
                        <button
                          onClick={() => handlePrintStatement(member)}
                          disabled={printingStatementId === member.id}
                          aria-label={`Print tab statement for ${member.name}`}
                          className="shrink-0 px-3 min-h-[36px] rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 font-bold text-xs transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-default focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
                        >
                          {printingStatementId === member.id ? 'Printing…' : 'Print'}
                        </button>
                        <button
                          onClick={() => setAdjustingMember(member)}
                          aria-label={`Adjust tab for ${member.name}`}
                          className="shrink-0 px-3 min-h-[36px] rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 font-bold text-xs transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
                        >
                          Adjust
                        </button>
                      </div>
                      {ordersLoading ? (
                        <p className="text-slate-400 text-xs">Loading orders…</p>
                      ) : orders?.fetchError ? (
                        <p className="text-red-400 text-xs">Failed to load orders. Please try again.</p>
                      ) : !orders?.length ? (
                        <p className="text-slate-400 text-xs">No tab orders found.</p>
                      ) : (
                        orders.map(order => (
                          <div key={order.id} className="bg-slate-800 rounded-xl p-3">
                            <div className="flex items-center justify-between mb-2">
                              <p className="text-slate-400 text-xs">
                                {new Date(order.created_at).toLocaleString('en-GB', {
                                  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                                })}
                                <span className="text-white font-bold ml-2">£{Number(order.total_amount).toFixed(2)}</span>
                              </p>
                              {removingOrderId === order.id ? (
                                <span className="text-slate-500 text-xs">Removing…</span>
                              ) : (
                                <button
                                  onClick={() => handleRemoveOrder(order, member)}
                                  aria-label="Remove order from tab"
                                  className="text-red-400 hover:text-red-300 text-xs font-medium cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-1"
                                >
                                  Remove
                                </button>
                              )}
                            </div>
                            <ul className="flex flex-col gap-1">
                              {order.order_items.map(item => (
                                <li key={item.id} className="flex justify-between text-xs text-slate-300">
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
