import { useState } from 'react'
import { Printer, Check } from 'lucide-react'
import { getPrinterIp, printReceipt, openDrawer } from '../lib/starPrinter'

export default function SettingsPage() {
  const [ip, setIp] = useState(() => getPrinterIp() ?? '')
  const [saveStatus, setSaveStatus] = useState(null)
  const [testStatus, setTestStatus] = useState(null)
  const [drawerStatus, setDrawerStatus] = useState(null)

  function handleSave() {
    localStorage.setItem('printer_ip', ip.trim())
    setSaveStatus('saved')
    setTimeout(() => setSaveStatus(null), 3000)
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
    } catch {
      setTestStatus('error')
    }
  }

  async function handleOpenDrawer() {
    setDrawerStatus(null)
    try {
      await openDrawer()
      setDrawerStatus('success')
    } catch {
      setDrawerStatus('error')
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
    </div>
  )
}
