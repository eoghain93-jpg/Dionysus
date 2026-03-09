import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { TrendingUp } from '../../lib/icons'

export default function TopProducts() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [products, setProducts] = useState([])

  useEffect(() => {
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    const sevenDaysAgoISO = sevenDaysAgo.toISOString()

    supabase
      .from('order_items')
      .select('product_id, quantity, unit_price, products(name)')
      .gte('created_at', sevenDaysAgoISO)
      .then(({ data, error: err }) => {
        if (err) {
          setError(err.message)
          return
        }
        const items = data ?? []

        // Aggregate by product_id
        const map = {}
        items.forEach(item => {
          const key = item.product_id
          const revenue = (item.quantity ?? 0) * (item.unit_price ?? 0)
          const name = item.products?.name ?? 'Unknown'
          if (!map[key]) {
            map[key] = { id: key, name, revenue: 0 }
          }
          map[key].revenue += revenue
        })

        const sorted = Object.values(map)
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 10)

        setProducts(sorted)
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <p className="text-slate-400 text-sm text-center py-8">Loading top products…</p>
    )
  }

  if (error) {
    return (
      <p className="text-red-400 text-sm text-center py-8">Error: {error}</p>
    )
  }

  if (products.length === 0) {
    return (
      <p className="text-slate-400 text-sm text-center py-8">No sales data for the last 7 days.</p>
    )
  }

  return (
    <ol className="flex flex-col divide-y divide-slate-700/50" aria-label="Top 10 products by revenue">
      {products.map((p, i) => (
        <li key={p.id} className="flex items-center gap-3 py-3">
          <span
            className="w-6 text-right text-slate-500 text-sm font-mono shrink-0"
            aria-hidden="true"
          >
            {i + 1}
          </span>
          <span className="flex-1 text-white text-sm truncate">{p.name}</span>
          <span className="text-[#22C55E] text-sm font-semibold shrink-0">
            £{p.revenue.toFixed(2)}
          </span>
        </li>
      ))}
    </ol>
  )
}
