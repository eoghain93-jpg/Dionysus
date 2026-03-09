import { AlertTriangle, AlertCircle, CheckCircle, Trash2, Plus, Edit2 } from '../../lib/icons'

/**
 * Computes the RAG (Red/Amber/Green) stock status for a product.
 * Returns { color, bgColor, Icon, label }
 *
 * Rules:
 *   par_level = 0  → always Green/Good
 *   stock < par    → Red/Low
 *   stock ≤ par * 1.5 → Amber/OK
 *   stock > par * 1.5 → Green/Good
 */
export function getStockStatus(stock_quantity, par_level) {
  if (par_level === 0) {
    return { color: 'text-green-400', bgColor: 'bg-green-400/10', Icon: CheckCircle, label: 'Good' }
  }
  if (stock_quantity < par_level) {
    return { color: 'text-red-400', bgColor: 'bg-red-400/10', Icon: AlertTriangle, label: 'Low' }
  }
  if (stock_quantity <= par_level * 1.5) {
    return { color: 'text-amber-400', bgColor: 'bg-amber-400/10', Icon: AlertCircle, label: 'OK' }
  }
  return { color: 'text-green-400', bgColor: 'bg-green-400/10', Icon: CheckCircle, label: 'Good' }
}

/**
 * Renders the RAG badge with colour + icon + text label (STOCK-01 accessibility).
 */
function StockBadge({ stock_quantity, par_level }) {
  const { color, bgColor, Icon, label } = getStockStatus(stock_quantity, par_level)
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold ${color} ${bgColor}`}
      aria-label={`Stock status: ${label}`}
    >
      <Icon size={12} aria-hidden="true" />
      {label}
    </span>
  )
}

/**
 * Renders the full list of products with stock info and action buttons.
 * Props:
 *   products          — array of product objects
 *   onWastage(product) — opens wastage modal
 *   onSpillage(product) — opens spillage modal  (kept separate so callers can differentiate if needed)
 *   onRestock(product) — opens restock modal
 *   onEdit(product)   — opens edit modal
 */
export default function StockList({ products, onWastage, onRestock, onEdit }) {
  if (products.length === 0) {
    return (
      <p className="text-slate-400 text-sm py-6 text-center">No products found.</p>
    )
  }

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-700">
            <th className="text-left px-3 py-3 text-slate-400 font-medium">Name</th>
            <th className="text-left px-3 py-3 text-slate-400 font-medium">Category</th>
            <th className="text-right px-3 py-3 text-slate-400 font-medium">Stock</th>
            <th className="text-right px-3 py-3 text-slate-400 font-medium">Par</th>
            <th className="text-center px-3 py-3 text-slate-400 font-medium">Status</th>
            <th className="text-right px-3 py-3 text-slate-400 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {products.map(product => (
            <tr
              key={product.id}
              className="border-b border-slate-800 hover:bg-slate-800/40 transition-colors"
            >
              <td className="px-3 py-3 text-white font-medium">{product.name}</td>
              <td className="px-3 py-3 text-slate-400 capitalize">{product.category}</td>
              <td className="px-3 py-3 text-white text-right font-mono">{product.stock_quantity}</td>
              <td className="px-3 py-3 text-slate-400 text-right font-mono">{product.par_level}</td>
              <td className="px-3 py-3 text-center">
                <StockBadge stock_quantity={product.stock_quantity} par_level={product.par_level} />
              </td>
              <td className="px-3 py-3">
                <div className="flex items-center justify-end gap-1">
                  {/* Wastage/Spillage */}
                  <button
                    onClick={() => onWastage(product)}
                    title="Log wastage or spillage"
                    aria-label={`Log wastage or spillage for ${product.name}`}
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-400/10 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </button>

                  {/* Restock */}
                  <button
                    onClick={() => onRestock(product)}
                    title="Restock"
                    aria-label={`Restock ${product.name}`}
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-400 hover:text-green-400 hover:bg-green-400/10 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
                  >
                    <Plus size={16} aria-hidden="true" />
                  </button>

                  {/* Edit */}
                  <button
                    onClick={() => onEdit(product)}
                    title="Edit product"
                    aria-label={`Edit ${product.name}`}
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-400 hover:text-blue-400 hover:bg-blue-400/10 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
                  >
                    <Edit2 size={16} aria-hidden="true" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
