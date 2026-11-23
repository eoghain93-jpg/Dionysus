import { memo, useState } from 'react'
import { Check, ChevronDown, ChevronUp, History } from 'lucide-react'
import {
  describeCheck, describeEntry, describeVia, describeWho, entrySeverity, fieldLabel, formatDateTime, formatTime,
  formatValue, happenedAt, tableNoun, tillLabel, uncheckedSeqs,
} from '../../lib/audit/describe'

// Colour AND words, so severity never depends on colour alone.
const SEVERITY = [
  { label: null, card: 'border-slate-800 bg-slate-800/40', bar: 'bg-slate-600', badge: '' },
  { label: 'Notable', card: 'border-slate-700 bg-slate-800/70', bar: 'bg-sky-500', badge: 'bg-sky-900/60 text-sky-200 border-sky-700/60' },
  { label: 'Needs a look', card: 'border-amber-600/70 bg-amber-950/30', bar: 'bg-amber-400', badge: 'bg-amber-900/60 text-amber-200 border-amber-600/60' },
  { label: 'Serious', card: 'border-red-500/80 bg-red-950/40', bar: 'bg-red-500', badge: 'bg-red-900/70 text-red-100 border-red-500/70' },
]

const TRUST_STYLE = {
  pin: 'bg-emerald-900/50 text-emerald-200 border-emerald-700/50',
  session_record: 'bg-sky-900/50 text-sky-200 border-sky-700/50',
  claimed: 'bg-amber-900/50 text-amber-200 border-amber-700/50',
  none: 'bg-slate-700/60 text-slate-300 border-slate-600',
}

const ACTOR_WORDS = {
  till: 'A till',
  member: 'A member’s own login (not a till)',
  service: 'The system itself (a server function, not a till)',
  database: 'Directly in the database',
  anon: 'Nobody signed in to anything',
}

const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString()

function exactTime(value) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'medium' })
}

const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v)

/**
 * One stored record as a list of "label: value". Empty values are left out
 * unless `showEmpty` (where "nothing" is itself what was written). `words`
 * replaces the value shown for a field.
 */
function RecordFields({ record, ctx, showEmpty = false, words = null }) {
  const fields = Object.entries(record ?? {})
    .filter(([key, value]) => key !== 'id' && (showEmpty || (value !== null && value !== undefined && value !== '')))
  if (fields.length === 0) return <p className="text-slate-500 text-sm">Nothing stored.</p>
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
      {fields.map(([key, value]) => (
        <div key={key} className="flex gap-2 text-sm min-w-0">
          <dt className="text-slate-500 shrink-0">{fieldLabel(key)}:</dt>
          <dd className="text-slate-200 break-all min-w-0">{words?.[key] ?? formatValue(key, value, ctx)}</dd>
        </div>
      ))}
    </dl>
  )
}

function Section({ title, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h4 className="text-slate-400 text-xs font-semibold uppercase tracking-wide">{title}</h4>
      {children}
    </div>
  )
}

/** Sale lines carry the product's name and list prices alongside (detail.lines). */
function withLineInfo(entry) {
  const info = isRecord(entry.detail?.lines) ? entry.detail.lines : {}
  const rows = Array.isArray(entry.new) ? entry.new : [entry.new]
  return rows.filter(isRecord).map(row => {
    const meta = isRecord(info[row.id]) ? info[row.id] : {}
    const { product_id: productId, ...rest } = row
    return meta.product
      ? { product: meta.product, ...rest, list_standard: meta.list_standard, list_member: meta.list_member, ...(meta.below_list_price ? { below_list_price: true } : {}) }
      : { product_id: productId, ...rest }
  })
}

function StoredValues({ entry, ctx }) {
  if (entry.kind === 'guard') {
    // A refused write to a member's protected details stores just those
    // fields (and never a PIN's value, so two PINs look alike here); any
    // other refused edit stores the whole record before and after.
    const fieldsOnly = entry.detail?.rule === 'protected_fields'
    const listed = fieldsOnly && Array.isArray(entry.changed) ? entry.changed : null
    const attempted = isRecord(entry.new) && isRecord(entry.old)
      ? Object.fromEntries(Object.entries(entry.new).filter(([k, v]) => (listed ? listed.includes(k) : JSON.stringify(v) !== JSON.stringify(entry.old[k]))))
      : null
    const wentThrough = String(entry.action ?? '').startsWith('would_block')
    const pinWords = attempted && attempted.pin_hash && entry.old.pin_hash ? { pin_hash: 'a different PIN (hidden)' } : null
    return (
      <>
        {isRecord(entry.old) && (
          <Section title={fieldsOnly ? 'As it was' : 'The record'}><RecordFields record={entry.old} ctx={ctx} showEmpty={fieldsOnly} /></Section>
        )}
        {attempted && Object.keys(attempted).length > 0 && (
          <Section title={wentThrough ? 'What it was changed to' : 'What they tried to change it to'}>
            <RecordFields record={attempted} ctx={ctx} showEmpty={fieldsOnly} words={pinWords} />
          </Section>
        )}
      </>
    )
  }
  if (entry.action === 'update' && (isRecord(entry.old) || isRecord(entry.new))) {
    const keys = Array.isArray(entry.changed) && entry.changed.length
      ? entry.changed
      : [...new Set([...Object.keys(entry.old ?? {}), ...Object.keys(entry.new ?? {})])]
    return (
      <Section title="Before and after">
        <dl className="flex flex-col gap-1.5">
          {keys.map(key => (
            <div key={key} className="text-sm min-w-0">
              <dt className="text-slate-500">{fieldLabel(key)}</dt>
              <dd className="text-slate-200 break-all">
                <span className="text-slate-400">{formatValue(key, entry.old?.[key], ctx)}</span>
                <span aria-hidden="true" className="text-slate-500"> → </span>
                <span className="sr-only"> changed to </span>
                <span className="text-white font-medium">{formatValue(key, entry.new?.[key], ctx)}</span>
              </dd>
            </div>
          ))}
        </dl>
      </Section>
    )
  }
  if (Array.isArray(entry.new)) {
    const rows = entry.table === 'order_items' ? withLineInfo(entry) : entry.new.filter(isRecord)
    return (
      <Section title={rows.length === 1 ? 'What was added' : `What was added (${rows.length})`}>
        <div className="flex flex-col gap-2">
          {rows.map((row, i) => (
            <div key={row.id ?? i} className="rounded-lg bg-slate-900/60 px-3 py-2">
              <RecordFields record={row} ctx={ctx} />
            </div>
          ))}
        </div>
      </Section>
    )
  }
  return (
    <>
      {isRecord(entry.new) && (
        <Section title={entry.action === 'insert' ? 'What was added' : 'New values'}><RecordFields record={entry.new} ctx={ctx} /></Section>
      )}
      {isRecord(entry.old) && (
        <Section title={entry.action === 'delete' ? 'What was deleted' : 'Old values'}><RecordFields record={entry.old} ctx={ctx} /></Section>
      )}
    </>
  )
}

function EntryDetail({ entry, ctx, onOpenRecord }) {
  const detail = isRecord(entry.detail) ? entry.detail : {}
  // Shown elsewhere on the card, or folded into the stored values above.
  const hidden = new Set(['flags', 'lines'])
  const extra = Object.fromEntries(Object.entries(detail).filter(([key]) => !hidden.has(key)))
  const lines = entry.sale_lines
  // Anything about a sale's lines belongs to the sale: the lines, a later
  // change to one and a refused attempt on one are all filed under the
  // sale's id (older entries about a single line carry it as order_id).
  const aboutLine = entry.table === 'order_items'
  const recordTable = aboutLine ? 'orders' : entry.table
  const recordPk = aboutLine && entry.action !== 'insert'
    ? (entry.old?.order_id ?? entry.new?.order_id ?? entry.pk)
    : entry.pk
  const canOpenRecord = onOpenRecord && entry.kind !== 'system' && recordTable && recordPk
  const numbers = [entry.seq, lines?.seq].filter(n => n !== null && n !== undefined)

  return (
    <div className="mt-3 pt-3 border-t border-slate-700/70 flex flex-col gap-4">
      <StoredValues entry={entry} ctx={ctx} />
      {lines && <StoredValues entry={lines} ctx={ctx} />}

      {Object.keys(extra).length > 0 && (
        <Section title="More detail"><RecordFields record={extra} ctx={ctx} /></Section>
      )}

      <Section title="How it got here">
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <div className="flex gap-2 min-w-0"><dt className="text-slate-500 shrink-0">Came from:</dt><dd className="text-slate-200 break-words min-w-0">{ACTOR_WORDS[entry.actor] ?? 'Unknown'}</dd></div>
          <div className="flex gap-2 min-w-0"><dt className="text-slate-500 shrink-0">How:</dt><dd className="text-slate-200 break-words min-w-0">{describeVia(entry.via)}</dd></div>
          <div className="flex gap-2 min-w-0"><dt className="text-slate-500 shrink-0">Network address:</dt><dd className="text-slate-200 break-all min-w-0">{entry.ip ?? 'not recorded'}</dd></div>
          <div className="flex gap-2 min-w-0"><dt className="text-slate-500 shrink-0">App version:</dt><dd className="text-slate-200 break-all min-w-0">{entry.app_build ?? 'not recorded'}</dd></div>
          <div className="flex gap-2 min-w-0"><dt className="text-slate-500 shrink-0">Recorded:</dt><dd className="text-slate-200 min-w-0">{exactTime(entry.at)}</dd></div>
          {entry.client_at && (
            <div className="flex gap-2 min-w-0"><dt className="text-slate-500 shrink-0">Till’s own clock said:</dt><dd className="text-slate-200 min-w-0">{exactTime(entry.client_at)}</dd></div>
          )}
          <div className="flex gap-2 min-w-0">
            <dt className="text-slate-500 shrink-0">Sealed:</dt>
            <dd className="text-slate-200 min-w-0">{entry.sealed && (!lines || lines.sealed) ? 'yes' : 'not yet (sealing runs every few minutes)'}</dd>
          </div>
          <div className="flex gap-2 min-w-0">
            <dt className="text-slate-500 shrink-0">{numbers.length > 1 ? 'Entry numbers:' : 'Entry number:'}</dt>
            <dd className="text-slate-200 min-w-0">{numbers.join(' and ')}</dd>
          </div>
        </dl>
      </Section>

      {canOpenRecord && (
        <button
          onClick={() => onOpenRecord(recordTable, recordPk)}
          className="self-start flex items-center gap-2 min-h-[44px] px-4 rounded-xl border border-slate-600 text-slate-200 hover:bg-slate-700 text-sm font-medium cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <History size={16} aria-hidden="true" />
          Everything recorded about this {tableNoun(recordTable)}
        </button>
      )}
    </div>
  )
}

/**
 * AuditEntry — one line of the log: when, who (and how sure the log is),
 * which till, what happened in plain English, why it is notable, and an
 * expander with the full detail.
 *
 * Props:
 *   entry         an audit_view entry (a sale may carry its lines as sale_lines)
 *   ctx           { names, sales } passed to describeEntry and describeWho
 *   onAck         (entry, note) => Promise — mark as checked; rejects on failure
 *   onOpenRecord  (table, pk) => void — show one record's whole history
 */
function AuditEntry({ entry, ctx, onAck, onOpenRecord }) {
  const [open, setOpen] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)
  const [note, setNote] = useState('')
  const [marking, setMarking] = useState(false)
  const [markError, setMarkError] = useState(null)

  const { title, lines, tags } = describeEntry(entry, ctx)
  const severity = entrySeverity(entry)
  const style = SEVERITY[severity] ?? SEVERITY[0]
  const who = describeWho(entry, ctx)
  const till = tillLabel(entry.till_id)
  const happened = happenedAt(entry)
  const needsCheck = uncheckedSeqs(entry).length > 0
  // Who marked it as checked, when and with what note — where the database
  // says (an older one only says that it was).
  const check = needsCheck ? null : describeCheck(entry)

  async function mark() {
    if (!onAck || marking) return
    setMarking(true)
    setMarkError(null)
    try {
      await onAck(entry, note.trim() || null)
      setNoteOpen(false)
      setNote('')
    } catch (err) {
      setMarkError(err?.message ?? 'Could not mark it as checked')
    } finally {
      setMarking(false)
    }
  }

  return (
    <li className={`rounded-xl border ${style.card}`}>
      <div className="flex gap-3 p-3">
        <span aria-hidden="true" className={`w-1.5 shrink-0 rounded-full ${style.bar}`} />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
            <time dateTime={entry.at} className="tabular-nums font-medium text-slate-300">{formatTime(entry.at)}</time>
            {happened && (
              <span className="text-amber-200">
                happened {sameDay(happened, entry.at) ? formatTime(happened) : formatDateTime(happened)}, arrived {formatTime(entry.at)}
              </span>
            )}
            {style.label && (
              <span className={`border rounded-md px-1.5 py-0.5 font-semibold ${style.badge}`}>{style.label}</span>
            )}
            {check && (
              <span className="flex items-center gap-1 text-emerald-300">
                <Check size={12} aria-hidden="true" />
                {`Checked${check.by ? ` by ${check.by}` : ''}${check.at ? ` · ${formatDateTime(check.at)}` : ''}`}
              </span>
            )}
            {/* Allowed (the owner works the bar too), but shown for what it is. */}
            {check?.bySelf && (
              <span className="border rounded-md px-1.5 py-0.5 font-semibold bg-amber-900/60 text-amber-200 border-amber-600/60">
                Checked by the person it is about
              </span>
            )}
          </div>

          <p className="text-white font-medium break-words mt-1">{title}</p>
          {lines.map((line, i) => (
            <p key={i} className="text-slate-300 text-sm break-words">{line}</p>
          ))}
          {check?.note && (
            <p className="text-emerald-200 text-sm break-words">Note left when it was checked: “{check.note}”</p>
          )}

          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-400 mt-1.5">
            <span className="text-slate-200">{who.name ?? 'Nobody signed in'}</span>
            {who.name && who.tag && (
              <span className={`border rounded-md px-1.5 py-0.5 text-xs ${TRUST_STYLE[who.trust] ?? TRUST_STYLE.none}`}>{who.tag}</span>
            )}
            {till && <span>· {till}</span>}
            {entry.kind === 'event' && <span className="text-xs text-slate-500 italic">· reported by the till</span>}
          </div>

          {tags.length > 0 && (
            <ul aria-label="Why this is notable" className="flex flex-wrap gap-1.5 mt-2">
              {tags.map(tag => (
                <li key={tag} className="text-xs border border-slate-600 bg-slate-900/60 text-slate-200 rounded-md px-2 py-0.5">{tag}</li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-center gap-x-1 gap-y-2 mt-2">
            <button
              onClick={() => setOpen(o => !o)}
              aria-expanded={open}
              className="flex items-center gap-1.5 min-h-[44px] px-2 rounded-lg text-slate-300 hover:bg-slate-700/70 text-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {open ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
              {open ? 'Hide detail' : 'Full detail'}
            </button>
            {needsCheck && onAck && (
              <>
                <button
                  onClick={mark}
                  disabled={marking}
                  className="flex items-center gap-1.5 min-h-[44px] px-3 rounded-lg bg-slate-200 hover:bg-white disabled:opacity-60 text-slate-900 text-sm font-bold cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <Check size={16} aria-hidden="true" />
                  {marking ? 'Marking…' : 'Mark as checked'}
                </button>
                {!noteOpen && (
                  <button
                    onClick={() => setNoteOpen(true)}
                    className="min-h-[44px] px-3 rounded-lg text-slate-300 hover:bg-slate-700/70 text-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    Add a note first
                  </button>
                )}
              </>
            )}
          </div>

          {needsCheck && noteOpen && (
            <input
              type="text"
              value={note}
              onChange={e => setNote(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') mark() }}
              maxLength={500}
              placeholder="What did you find? (optional)"
              aria-label="Note for this alert"
              className="mt-2 w-full bg-[#0F172A] border border-slate-600 rounded-xl px-3 py-2 text-white placeholder-slate-500 min-h-[44px] focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          )}
          {markError && <p role="alert" className="text-red-300 text-sm mt-2">{markError}</p>}

          {open && <EntryDetail entry={entry} ctx={ctx} onOpenRecord={onOpenRecord} />}
        </div>
      </div>
    </li>
  )
}

// A long log is hundreds of these; typing in the search box should not
// redraw every one.
export default memo(AuditEntry)
