import { useState } from 'react'
import { Printer, Check, Lock } from 'lucide-react'
import { getPrinterIp, printReceipt, openDrawer } from '../lib/starPrinter'
import { logEvent } from '../lib/audit/log'

// Minutes without a touch before the till locks itself. Read by the idle
// lock; 0 means never. Shown as 5 until someone chooses otherwise.
const IDLE_LOCK_KEY = 'idle_lock_minutes'
const IDLE_LOCK_DEFAULT = 5
const IDLE_LOCK_CHOICES = [0, 1, 2, 3, 5, 10, 15, 20, 30, 60]

function storedIdleLockMinutes() {
  try {
    const raw = localStorage.getItem(IDLE_LOCK_KEY)
    if (raw === null || raw.trim() === '') return null
    const n = Number(raw)
    return Number.isFinite(n) && n >= 0 ? n : null
  } catch {
    return null
  }
}

export default function SettingsPage() {
  const [ip, setIp] = useState(() => getPrinterIp() ?? '')
  const [saveStatus, setSaveStatus] = useState(null)
  const [testStatus, setTestStatus] = useState(null)
  const [drawerStatus, setDrawerStatus] = useState(null)
  const [idleMinutes, setIdleMinutes] = useState(() => storedIdleLockMinutes() ?? IDLE_LOCK_DEFAULT)

  function handleSave() {
    const from = localStorage.getItem('printer_ip') ?? ''
    const to = ip.trim()
    localStorage.setItem('printer_ip', to)
    // A blank IP silently switches off receipts AND the cash drawer; another
    // IP sends both to a different till's printer.
    if (to !== from) logEvent('settings.printer_ip_changed', { from, to }, { severity: 2 })
    setSaveStatus('saved')
    setTimeout(() => setSaveStatus(null), 3000)
  }

  function handleIdleLockChange(value) {
    const to = Number(value)
    if (!Number.isFinite(to) || to < 0) return
    const from = storedIdleLockMinutes() ?? IDLE_LOCK_DEFAULT
    try { localStorage.setItem(IDLE_LOCK_KEY, String(to)) } catch { return }
    setIdleMinutes(to)
    // Turning the lock off (or up) leaves a signed-in till open to anyone.
    logEvent('settings.idle_lock_changed', { from, to }, { severity: 2 })
  }

  async function handleTest() {
    setTestStatus(null)
    if (!ip.trim()) {
      setTestStatus('simulation')
      return
    }
    try {
      await printReceipt({
        orderId: 'TEST0000',
        total: 0.00,
        paymentMethod: 'card',
        createdAt: new Date().toISOString(),
      })
      setTestStatus('success')
      // The test slip is a card-type receipt, so it kicks the drawer too.
      // (With no IP saved the job is skipped, so there is nothing to log.)
      if (getPrinterIp()) logEvent('printer.test_printed', { ok: true }, { severity: 1 })
    } catch (err) {
      setTestStatus('error')
      logEvent('printer.test_printed', { ok: false }, { severity: 1 })
      logEvent('receipt.print_failed', { what: 'test', message: String(err?.message ?? err).slice(0, 300) }, { severity: 1 })
    }
  }

  async function handleOpenDrawer() {
    setDrawerStatus(null)
    try {
      await openDrawer()
      setDrawerStatus('success')
      // The classic "no sale": the drawer opened with nothing rung.
      // (With no IP saved the kick is skipped, so there is nothing to log.)
      if (getPrinterIp()) logEvent('drawer.opened_no_sale', { source: 'settings' }, { severity: 2 })
    } catch (err) {
      setDrawerStatus('error')
      logEvent('drawer.open_failed', { source: 'settings', message: String(err?.message ?? err).slice(0, 300) }, { severity: 1 })
    }
  }

  return (
    <div className="ui-page">
      <div className="ui-page-header">
        <h1 className="ui-title">Settings</h1>
      </div>

      <section className="ui-card p-5 flex flex-col gap-5 w-full max-w-xl">
        <div className="flex items-center gap-2.5">
          <Printer size={22} className="text-slate-400" aria-hidden="true" />
          <h2 className="ui-section-title">Receipt Printer</h2>
        </div>

        <div>
          <label htmlFor="printer-ip" className="ui-label">
            Printer IP Address
          </label>
          <div className="flex gap-3 flex-wrap">
            <input
              id="printer-ip"
              type="text"
              value={ip}
              onChange={e => setIp(e.target.value)}
              placeholder="e.g. 192.168.1.100"
              className="ui-input flex-1 basis-48 w-auto"
            />
            <button onClick={handleSave} className="ui-btn ui-btn-primary min-w-[96px]">
              Save
            </button>
          </div>
          {saveStatus === 'saved' && (
            <p role="alert" className="text-emerald-300 text-[15px] font-semibold flex items-center gap-1.5 mt-2">
              <Check size={16} aria-hidden="true" /> Saved
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-2">
            <button onClick={handleTest} className="ui-btn ui-btn-secondary w-full">
              Test Connection
            </button>
            {testStatus === 'success' && (
              <p role="alert" className="text-emerald-300 text-[15px] font-semibold flex items-center gap-1.5">
                <Check size={16} aria-hidden="true" /> Test print sent
              </p>
            )}
            {testStatus === 'error' && (
              <p role="alert" className="ui-error text-[15px]">Connection failed — check IP and printer power</p>
            )}
            {testStatus === 'simulation' && (
              <p role="alert" className="text-slate-400 text-[15px]">Simulation mode — no IP configured</p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <button onClick={handleOpenDrawer} className="ui-btn ui-btn-secondary w-full">
              Open Drawer
            </button>
            {drawerStatus === 'success' && (
              <p role="alert" className="text-emerald-300 text-[15px] font-semibold flex items-center gap-1.5">
                <Check size={16} aria-hidden="true" /> Drawer opened
              </p>
            )}
            {drawerStatus === 'error' && (
              <p role="alert" className="ui-error text-[15px]">Failed to open drawer</p>
            )}
          </div>
        </div>
      </section>

      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3 mt-4">
        <div className="flex items-center gap-2">
          <Lock size={18} className="text-slate-400" aria-hidden="true" />
          <h2 className="text-white font-semibold">Till Lock</h2>
        </div>
        <div className="flex items-center gap-2 flex-wrap text-slate-300 text-sm">
          <label htmlFor="idle-lock-minutes">Lock the till after</label>
          <select
            id="idle-lock-minutes"
            value={String(idleMinutes)}
            onChange={e => handleIdleLockChange(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white text-sm
              focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px] cursor-pointer"
          >
            {/* A value saved some other way still shows as itself. */}
            {[...new Set([...IDLE_LOCK_CHOICES, idleMinutes])].sort((a, b) => a - b).map(n => (
              <option key={n} value={String(n)}>{n === 0 ? '0 (never)' : n}</option>
            ))}
          </select>
          <span>minutes without a touch</span>
        </div>
        <p className="text-slate-500 text-xs">0 = never lock. Staff sign back in with their PIN.</p>
      </section>
    </div>
  )
}
