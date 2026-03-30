// src/pages/TabsPage.jsx
import { useState, useEffect, useCallback } from 'react'
import { ChevronRight } from '../lib/icons'
import { fetchOpenTabs, fetchTabOrders } from '../lib/tabs'
import SettleTabModal from '../components/members/SettleTabModal'

export default function TabsPage() {
  const [tabs, setTabs] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState(null)
  const [expandedOrders, setExpandedOrders] = useState({})
  const [expandedLoading, setExpandedLoading] = useState({})
  const [settlingMember, setSettlingMember] = useState(null)

  const loadTabs = useCallback(() => {
    setLoading(true)
    fetchOpenTabs()
      .then(setTabs)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { loadTabs() }, [loadTabs])

  function toggleExpand(id) {
    const isCurrentlyExpanded = expandedId === id
    const next = isCurrentlyExpanded ? null : id
    setExpandedId(next)
    if (next && !expandedOrders[id]) {
      setExpandedLoading(l => ({ ...l, [id]: true }))
      fetchTabOrders(id)
        .then(orders => setExpandedOrders(o => ({ ...o, [id]: orders })))
        .catch(console.error)
        .finally(() => setExpandedLoading(l => ({ ...l, [id]: false })))
    }
  }

  function handleSettled(memberId) {
    setSettlingMember(null)
    setTabs(prev => prev.filter(m => m.id !== memberId))
  }

  const total = tabs.reduce((sum, m) => sum + Number(m.tab_balance), 0)

  return (
    <div className="flex flex-col h-full min-h-0 p-4 gap-4 overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1
          className="text-2xl font-bold text-white"
          style={{ fontFamily: "'Playfair Display SC', serif" }}
        >
          Tabs
        </h1>
        {tabs.length > 0 && (
          <div className="text-right">
            <p className="text-slate-400 text-xs">Total outstanding</p>
            <p className="text-white font-bold text-lg">£{total.toFixed(2)}</p>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 bg-[#0F172A] rounded-2xl border border-slate-700 overflow-hidden">
        {loading ? (
          <p className="text-slate-400 text-sm p-6 text-center">Loading open tabs…</p>
        ) : tabs.length === 0 ? (
          <p className="text-slate-400 text-sm p-6 text-center">No open tabs.</p>
        ) : (
          <ul className="divide-y divide-slate-700">
            {tabs.map(member => {
              const isExpanded = expandedId === member.id
              const orders = expandedOrders[member.id]
              const ordersLoading = expandedLoading[member.id]
              return (
                <li key={member.id}>
                  {/* Row */}
                  <div className="flex items-center gap-3 px-4 py-3">
                    <button
                      onClick={() => toggleExpand(member.id)}
                      className="flex-1 flex items-center gap-3 text-left focus:outline-none"
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
                      </div>
                      <span className="text-white font-bold text-sm shrink-0">
                        £{Number(member.tab_balance).toFixed(2)}
                      </span>
                    </button>
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
                      {ordersLoading ? (
                        <p className="text-slate-400 text-xs">Loading orders…</p>
                      ) : !orders?.length ? (
                        <p className="text-slate-400 text-xs">No tab orders found.</p>
                      ) : (
                        orders.map(order => (
                          <div key={order.id} className="bg-slate-800 rounded-xl p-3">
                            <p className="text-slate-400 text-xs mb-2">
                              {new Date(order.created_at).toLocaleString('en-GB', {
                                day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                              })}
                              <span className="text-white font-bold ml-2">£{Number(order.total_amount).toFixed(2)}</span>
                            </p>
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
          onSettled={() => handleSettled(settlingMember.id)}
        />
      )}
    </div>
  )
}
