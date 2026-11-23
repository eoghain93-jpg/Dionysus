import { AlertTriangle, AlertCircle, CheckCircle, Trash2, Plus, Edit2 } from '../../lib/icons'

/**
 * Computes the RAG (Red/Amber/Green) stock status for a product.
 * Returns { color, bgColor, tag, Icon, label } (tag = shared UI-kit tag class)
 *
 * Rules:
 *   par_level = 0  → always Green/Good
 *   stock < par    → Red/Low
 *   stock ≤ par * 1.5 → Amber/OK
 *   stock > par * 1.5 → Green/Good
 */
export function getStockStatus(stock_quantity, par_level) {
  if (par_level === 0) {
    return { color: 'text-green-400', bgColor: 'bg-green-400/10', tag: 'ui-tag-good', Icon: CheckCircle, label: 'Good' }
  }
  if (stock_quantity < par_level) {
    return { color: 'text-red-400', bgColor: 'bg-red-400/10', tag: 'ui-tag-bad', Icon: AlertTriangle, label: 'Low' }
  }
  if (stock_quantity <= par_level * 1.5) {
    return { color: 'text-amber-400', bgColor: 'bg-amber-400/10', tag: 'ui-tag-warn', Icon: AlertCircle, label: 'OK' }
  }
  return { color: 'text-green-400', bgColor: 'bg-green-400/10', tag: 'ui-tag-good', Icon: CheckCircle, label: 'Good' }
}

/**
 * Renders the RAG badge with colour + icon + text label (STOCK-01 accessibility).
 */
function StockBadge({ stock_quantity, par_level }) {
  const { tag, Icon, label } = getStockStatus(stock_quantity, par_level)
  return (
    <span
      className={`ui-tag ${tag}`}
      aria-label={`Stock status: ${label}`}
    >
      <Icon size={14} aria-hidden="true" />
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
      <p className="ui-empty">No products found.</p>
    )
  }

  return (
    <div className="w-full flex-1 min-h-0 overflow-auto">
      <table className="w-full min-w-[720px] border-collapse">
        <thead className="sticky top-0 z-10 bg-slate-900 shadow-[0_1px_0_0_var(--color-slate-800)]">
          <tr>
            <th className="ui-th">Name</th>
            <th className="ui-th">Category</th>
            <th className="ui-th text-right">Stock</th>
            <th className="ui-th text-right">Par</th>
            <th className="ui-th text-center">Status</th>
            <th className="ui-th text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {products.map(product => (
            <tr
              key={product.id}
              className="border-b border-slate-800 last:border-b-0"
            >
              <td className="ui-td text-white text-base font-bold">{product.name}</td>
              <td className="ui-td text-slate-300 capitalize">{product.category}</td>
              <td className="ui-td text-white text-lg text-right font-extrabold tabular-nums">{product.stock_quantity}</td>
              <td className="ui-td text-slate-400 text-right tabular-nums">{product.par_level}</td>
              <td className="ui-td text-center">
                <StockBadge stock_quantity={product.stock_quantity} par_level={product.par_level} />
              </td>
              <td className="ui-td py-2">
                <div className="flex items-center justify-end gap-2">
                  {/* Wastage/Spillage */}
                  <button
                    onClick={() => onWastage(product)}
                    title="Log wastage or spillage"
                    aria-label={`Log wastage or spillage for ${product.name}`}
                    className="ui-btn ui-btn-danger ui-btn-icon"
                  >
                    <Trash2 size={20} aria-hidden="true" />
                  </button>

                  {/* Restock */}
                  <button
                    onClick={() => onRestock(product)}
                    title="Restock"
                    aria-label={`Restock ${product.name}`}
                    className="ui-btn ui-btn-secondary ui-btn-icon"
                  >
                    <Plus size={20} aria-hidden="true" />
                  </button>

                  {/* Edit */}
                  <button
                    onClick={() => onEdit(product)}
                    title="Edit product"
                    aria-label={`Edit ${product.name}`}
                    className="ui-btn ui-btn-ghost ui-btn-icon"
                  >
                    <Edit2 size={20} aria-hidden="true" />
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
