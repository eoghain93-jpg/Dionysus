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
    <div className="p-6 max-w-lg">
      <h1 className="text-white text-xl font-bold mb-6">Settings</h1>

      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Printer size={18} className="text-slate-400" aria-hidden="true" />
          <h2 className="text-white font-semibold">Receipt Printer</h2>
        </div>

        <div className="space-y-2">
          <label htmlFor="printer-ip" className="text-slate-400 text-sm block">
            Printer IP Address
          </label>
          <div className="flex gap-2">
            <input
              id="printer-ip"
              type="text"
              value={ip}
              onChange={e => setIp(e.target.value)}
              placeholder="e.g. 192.168.1.100"
              className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2
                text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={handleSave}
              className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold
                px-4 py-2 rounded-xl transition-colors cursor-pointer min-h-[44px]"
            >
              Save
            </button>
          </div>
          {saveStatus === 'saved' && (
            <p role="alert" className="text-emerald-400 text-xs flex items-center gap-1">
              <Check size={12} aria-hidden="true" /> Saved
            </p>
          )}
        </div>

        <div className="flex gap-3 pt-1">
          <div className="flex-1 space-y-1">
            <button
              onClick={handleTest}
              className="w-full bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium
                py-3 rounded-xl transition-colors cursor-pointer min-h-[44px]"
            >
              Test Connection
            </button>
            {testStatus === 'success' && (
              <p role="alert" className="text-emerald-400 text-xs flex items-center gap-1">
                <Check size={12} aria-hidden="true" /> Test print sent
              </p>
            )}
            {testStatus === 'error' && (
              <p role="alert" className="text-red-400 text-xs">Connection failed — check IP and printer power</p>
            )}
            {testStatus === 'simulation' && (
              <p role="alert" className="text-slate-400 text-xs">Simulation mode — no IP configured</p>
            )}
          </div>

          <div className="flex-1 space-y-1">
            <button
              onClick={handleOpenDrawer}
              className="w-full bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium
                py-3 rounded-xl transition-colors cursor-pointer min-h-[44px]"
            >
              Open Drawer
            </button>
            {drawerStatus === 'success' && (
              <p role="alert" className="text-emerald-400 text-xs flex items-center gap-1">
                <Check size={12} aria-hidden="true" /> Drawer opened
              </p>
            )}
            {drawerStatus === 'error' && (
              <p role="alert" className="text-red-400 text-xs">Failed to open drawer</p>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
