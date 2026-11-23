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
      <p className="ui-empty">Loading top products…</p>
    )
  }

  if (error) {
    return (
      <p className="ui-banner ui-banner-bad m-4">Error: {error}</p>
    )
  }

  if (products.length === 0) {
    return (
      <p className="ui-empty">No sales data for the last 7 days.</p>
    )
  }

  return (
    <ol className="flex flex-col" aria-label="Top 10 products by revenue">
      {products.map((p, i) => (
        <li key={p.id} className="ui-row min-h-[56px]">
          <span
            className="w-7 text-right text-slate-400 text-[15px] font-bold shrink-0"
            aria-hidden="true"
          >
            {i + 1}
          </span>
          <span className="flex-1 min-w-0 text-white text-[17px] font-semibold truncate">{p.name}</span>
          <span className="text-white text-[17px] font-extrabold shrink-0">
            £{p.revenue.toFixed(2)}
          </span>
        </li>
      ))}
    </ol>
  )
}
