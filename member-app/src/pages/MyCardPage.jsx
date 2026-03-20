import { QRCodeSVG } from 'qrcode.react'
import { useAuthStore } from '../stores/authStore'

export default function MyCardPage() {
  const { member } = useAuthStore()

  if (!member) return null

  const tierLabel = member.membership_tier === 'staff' ? 'Staff' : 'Member'

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-6 gap-8">
      <div className="bg-gradient-to-br from-blue-800 to-slate-800 rounded-3xl p-8 w-full max-w-sm shadow-2xl">
        <div className="text-slate-400 text-xs uppercase tracking-widest mb-6">Club Membership</div>
        <div className="text-white text-2xl font-bold mb-1">{member.name}</div>
        <div className="text-blue-300 text-sm mb-8">{tierLabel}</div>
        <div className="bg-white rounded-2xl p-4 flex items-center justify-center mb-6">
          <QRCodeSVG value={member.membership_number} size={180} />
        </div>
        <div className="text-center">
          <div className="text-slate-400 text-xs mb-1">Membership Number</div>
          <div className="text-white text-xl font-mono tracking-widest">{member.membership_number}</div>
        </div>
      </div>
      <p className="text-slate-500 text-xs text-center">
        Show this QR code at the bar to be identified
      </p>
    </div>
  )
}
