import { useState, useEffect } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts'
import { supabase } from '../../lib/supabase'

function formatHour(h) {
  if (h === 0) return '12am'
  if (h < 12) return `${h}am`
  if (h === 12) return '12pm'
  return `${h - 12}pm`
}

export default function BusiestHours() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [chartData, setChartData] = useState([])

  useEffect(() => {
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    const sevenDaysAgoISO = sevenDaysAgo.toISOString()

    supabase
      .from('orders')
      .select('created_at, total_amount, status')
      .gte('created_at', sevenDaysAgoISO)
      .eq('status', 'paid')
      .then(({ data, error: err }) => {
        if (err) {
          setError(err.message)
          return
        }
        const orders = data ?? []

        // Count orders per hour
        const counts = Array.from({ length: 24 }, () => 0)
        orders.forEach(o => {
          const hour = new Date(o.created_at).getHours()
          counts[hour] += 1
        })

        const data24 = counts.map((count, h) => ({
          hour: formatHour(h),
          orders: count,
        }))

        setChartData(data24)
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <p className="text-slate-400 text-sm text-center py-8">Loading busiest hours…</p>
    )
  }

  if (error) {
    return (
      <p className="text-red-400 text-sm text-center py-8">Error: {error}</p>
    )
  }

  return (
    <div role="img" aria-label="Busiest hours bar chart, last 7 days">
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" vertical={false} />
          <XAxis
            dataKey="hour"
            tick={{ fill: '#94A3B8', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            interval={2}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fill: '#94A3B8', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#0F172A',
              border: '1px solid #1E293B',
              borderRadius: 8,
              color: '#F8FAFC',
              fontSize: 12,
            }}
            cursor={{ fill: '#1E293B' }}
            formatter={v => [v, 'Orders']}
          />
          <Bar dataKey="orders" fill="#22C55E" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
