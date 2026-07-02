import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchProducts } from '../lib/products'
import { buildStocktake, buildLines, summarizeVariances, saveStocktake } from '../lib/stocktakes'
import { hasContainer, servingsFromCount, lastCountedLabel } from '../lib/containers'
import { useSyncStore } from '../stores/syncStore'
import { useSessionStore } from '../stores/sessionStore'
import { useToastStore } from '../hooks/useToast'
import { ChevronLeft, ChevronRight, Plus, Minus, CheckCircle, ClipboardCheck } from '../lib/icons'

const CATEGORIES = ['all', 'draught', 'bottle', 'spirit', 'soft', 'food', 'other']

// Fill levels a human can actually judge on a live keg/open case. Anything
// finer is false precision.
const PARTIALS = [
  { value: 0, label: 'Empty' },
  { value: 0.25, label: '¼' },
  { value: 0.5, label: '½' },
  { value: 0.75, label: '¾' },
]

/**
 * Guided stocktake: pick a scope, count each product one at a time
 * (container-first when the product has container config), review only the
 * surprises, confirm. Works fully offline — the finished count queues like
 * a till order. Counting is deliberately "blind" (the expected figure is
 * not shown until review) so the count records what's on the shelf, not
 * what the till anchored the counter to.
 */
export default function CountPage() {
  const navigate = useNavigate()
  const isOnline = useSyncStore(s => s.isOnline)
  const activeStaff = useSessionStore(s => s.activeStaff)

  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [stage, setStage] = useState('setup') // setup | counting | review
  const [scope, setScope] = useState('all')
  const [startedAt, setStartedAt] = useState(null)
  const [index, setIndex] = useState(0)
  const [counts, setCounts] = useState({}) // product_id -> { containers, partial, quantity, skipped }
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchProducts().then(setProducts).catch(console.error).finally(() => setLoading(false))
  }, [])

  const toCount = useMemo(
    () => products.filter(p => scope === 'all' || p.category === scope),
    [products, scope]
  )
  const current = toCount[index]
  const entry = current ? counts[current.id] : undefined

  function startCount() {
    setStartedAt(new Date().toISOString())
    setIndex(0)
    setCounts({})
    setStage('counting')
  }

  function updateEntry(patch) {
    setCounts(prev => ({
      ...prev,
      [current.id]: { containers: 0, partial: 0, quantity: '', skipped: false, ...prev[current.id], ...patch },
    }))
  }

  function next() {
    if (index + 1 < toCount.length) setIndex(index + 1)
    else setStage('review')
  }

  function back() {
    if (index > 0) setIndex(index - 1)
    else setStage('setup')
  }

  // Counted products only — a skipped (or never-visited) product is left
  // untouched: no line, no adjustment, no last_counted_at.
  const countedList = useMemo(() => toCount
    .map(product => {
      const e = counts[product.id]
      if (!e || e.skipped) return null
      const countedQty = hasContainer(product)
        ? servingsFromCount(product, e.containers, e.partial)
        : Number(e.quantity)
      if (!Number.isFinite(countedQty)) return null
      return { product, countedQty }
    })
    .filter(Boolean), [toCount, counts])

  const variances = useMemo(() => summarizeVariances(countedList), [countedList])

  async function handleConfirm() {
    setSaving(true)
    const stocktake = buildStocktake({
      scope,
      staffId: activeStaff?.id ?? null,
      notes: notes.trim() || null,
      startedAt,
    })
    const result = await saveStocktake(stocktake, buildLines(countedList), isOnline)
    if (result === 'failed') {
      useToastStore.getState().addToast('Count could not be saved — try again', 'error')
      setSaving(false)
      return
    }
    if (result === 'online') {
      useToastStore.getState().addToast('Count saved — stock re-baselined', 'success')
    } else {
      useToastStore.getState().addToast('Count saved offline — will sync when back online', 'success')
    }
    navigate('/stock')
  }

  if (loading) {
    return <p className="text-slate-400 text-sm p-6 text-center">Loading products…</p>
  }

  // ── Stage 1: scope ────────────────────────────────────────────────────
  if (stage === 'setup') {
    return (
      <div className="max-w-lg mx-auto p-4 flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <ClipboardCheck size={24} className="text-green-400" aria-hidden="true" />
          <h1 className="text-2xl font-bold text-white">Start a count</h1>
        </div>
        <p className="text-slate-400 text-sm">
          Walk the shelf and enter what you see. You can count everything or
          just one category — products you skip are left untouched.
        </p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="What to count">
          {CATEGORIES.map(c => (
            <button
              key={c}
              role="radio"
              aria-checked={scope === c}
              onClick={() => setScope(c)}
              className={`px-4 min-h-[44px] rounded-xl text-sm font-medium capitalize transition-colors cursor-pointer
                ${scope === c ? 'bg-blue-600 text-white' : 'bg-[#1E293B] text-slate-300 hover:bg-slate-700'}`}
            >
              {c === 'all' ? 'Everything' : c}
            </button>
          ))}
        </div>
        <p className="text-slate-500 text-sm">
          {toCount.length} product{toCount.length === 1 ? '' : 's'} to count
          {!isOnline && ' — offline is fine, the count will sync later'}
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => navigate('/stock')}
            className="flex-1 min-h-[48px] rounded-xl border border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors cursor-pointer text-sm font-medium"
          >
            Cancel
          </button>
          <button
            onClick={startCount}
            disabled={toCount.length === 0}
            className="flex-1 min-h-[48px] rounded-xl bg-[#22C55E] hover:bg-green-400 disabled:opacity-50 text-slate-900 font-bold text-sm transition-colors cursor-pointer"
          >
            Start counting
          </button>
        </div>
      </div>
    )
  }

  // ── Stage 3: review (only the surprises) ─────────────────────────────
  if (stage === 'review') {
    return (
      <div className="max-w-lg mx-auto p-4 flex flex-col gap-5">
        <h1 className="text-2xl font-bold text-white">Check the surprises</h1>
        <p className="text-slate-400 text-sm">
          {countedList.length} product{countedList.length === 1 ? '' : 's'} counted.{' '}
          {variances.length === 0
            ? 'Everything matches what the till expected.'
            : `${variances.length} didn't match what the till expected:`}
        </p>

        {variances.map(v => (
          <div key={v.product.id} className="bg-[#0F172A] border border-slate-700 rounded-2xl p-4 flex items-center gap-3">
            <div className="flex-1">
              <p className="text-white font-medium">{v.product.name}</p>
              <p className="text-sm text-slate-400">
                Till expected {v.expected}, you counted {v.counted}
                {' — '}
                <span className={v.valueRetail < 0 ? 'text-red-400' : 'text-green-400'}>
                  {v.valueRetail < 0 ? '−' : '+'}£{Math.abs(v.valueRetail).toFixed(2)} at retail
                </span>
              </p>
            </div>
            <button
              onClick={() => { setIndex(toCount.findIndex(p => p.id === v.product.id)); setStage('counting') }}
              className="px-3 min-h-[44px] rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700 text-sm cursor-pointer"
            >
              Recount
            </button>
          </div>
        ))}

        <div className="flex flex-col gap-1">
          <label htmlFor="count-notes" className="text-sm font-medium text-slate-300">
            Notes <span className="text-slate-500 font-normal">(optional)</span>
          </label>
          <input
            id="count-notes"
            type="text"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="e.g. line clean day, delivery not shelved yet"
            className="bg-[#1E293B] border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 min-h-[44px]"
          />
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => setStage('counting')}
            className="flex-1 min-h-[48px] rounded-xl border border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors cursor-pointer text-sm font-medium"
          >
            Back
          </button>
          <button
            onClick={handleConfirm}
            disabled={saving || countedList.length === 0}
            className="flex-1 min-h-[48px] rounded-xl bg-[#22C55E] hover:bg-green-400 disabled:opacity-50 text-slate-900 font-bold text-sm transition-colors cursor-pointer"
          >
            {saving ? 'Saving…' : 'Confirm count'}
          </button>
        </div>
      </div>
    )
  }

  // ── Stage 2: counting, one product at a time ─────────────────────────
  const containerMode = hasContainer(current)
  const counted = containerMode
    ? servingsFromCount(current, entry?.containers ?? 0, entry?.partial ?? 0)
    : Number(entry?.quantity)

  return (
    <div className="max-w-lg mx-auto p-4 flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <button
          onClick={back}
          aria-label="Back"
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-400 hover:text-white cursor-pointer"
        >
          <ChevronLeft size={20} aria-hidden="true" />
        </button>
        <p className="text-slate-400 text-sm">{index + 1} / {toCount.length}</p>
        <button
          onClick={() => { updateEntry({ skipped: true }); next() }}
          className="min-h-[44px] px-3 text-slate-400 hover:text-white text-sm cursor-pointer"
        >
          Skip
        </button>
      </div>

      <div className="bg-[#0F172A] border border-slate-700 rounded-2xl p-5 flex flex-col gap-4">
        <div>
          <h2 className="text-xl font-bold text-white">{current.name}</h2>
          <p className="text-sm text-slate-500 capitalize">
            {current.category}
            {lastCountedLabel(current) ? ` · ${lastCountedLabel(current).toLowerCase()}` : ' · never counted'}
          </p>
        </div>

        {containerMode ? (
          <>
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-slate-300">
                Full {current.container_name}s
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => updateEntry({ containers: Math.max(0, (entry?.containers ?? 0) - 1) })}
                  aria-label={`One less ${current.container_name}`}
                  className="min-h-[56px] min-w-[56px] rounded-xl bg-[#1E293B] text-white flex items-center justify-center cursor-pointer hover:bg-slate-700"
                >
                  <Minus size={20} aria-hidden="true" />
                </button>
                <span className="flex-1 text-center text-3xl font-bold text-white font-mono" aria-live="polite">
                  {entry?.containers ?? 0}
                </span>
                <button
                  onClick={() => updateEntry({ containers: (entry?.containers ?? 0) + 1 })}
                  aria-label={`One more ${current.container_name}`}
                  className="min-h-[56px] min-w-[56px] rounded-xl bg-[#1E293B] text-white flex items-center justify-center cursor-pointer hover:bg-slate-700"
                >
                  <Plus size={20} aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-slate-300">
                And the open {current.container_name}?
              </p>
              <div className="flex gap-2" role="radiogroup" aria-label="Open container fill level">
                {PARTIALS.map(p => (
                  <button
                    key={p.value}
                    role="radio"
                    aria-checked={(entry?.partial ?? 0) === p.value}
                    onClick={() => updateEntry({ partial: p.value })}
                    className={`flex-1 min-h-[48px] rounded-xl text-sm font-medium transition-colors cursor-pointer
                      ${(entry?.partial ?? 0) === p.value ? 'bg-blue-600 text-white' : 'bg-[#1E293B] text-slate-300 hover:bg-slate-700'}`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <p className="text-sm text-slate-500">
              ≈ {counted} {current.unit === 'each' ? '' : `${current.unit}s `}in stock
            </p>
          </>
        ) : (
          <div className="flex flex-col gap-2">
            <label htmlFor="count-qty" className="text-sm font-medium text-slate-300">
              How many {current.unit === 'each' ? '' : `${current.unit}s `}do you see?
            </label>
            <input
              id="count-qty"
              type="number"
              min="0"
              step="1"
              inputMode="numeric"
              value={entry?.quantity ?? ''}
              onChange={e => updateEntry({ quantity: e.target.value })}
              placeholder="0"
              className="bg-[#1E293B] border border-slate-600 rounded-lg px-3 py-3 text-white text-2xl font-mono text-center placeholder-slate-600 min-h-[56px]"
            />
          </div>
        )}
      </div>

      <button
        onClick={() => { updateEntry({ skipped: false }); next() }}
        disabled={!containerMode && !Number.isFinite(counted)}
        className="min-h-[56px] rounded-xl bg-[#22C55E] hover:bg-green-400 disabled:opacity-50 text-slate-900 font-bold text-base transition-colors cursor-pointer flex items-center justify-center gap-2"
      >
        {index + 1 === toCount.length ? (
          <>Review count <CheckCircle size={18} aria-hidden="true" /></>
        ) : (
          <>Next <ChevronRight size={18} aria-hidden="true" /></>
        )}
      </button>
    </div>
  )
}
