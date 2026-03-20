import { useAuthStore } from '../stores/authStore'

export default function AccountPage() {
  const { member, signOut } = useAuthStore()

  if (!member) return null

  return (
    <div className="bg-slate-900 min-h-screen p-4">
      <h1 className="text-white text-xl font-bold mb-6 pt-4">Account</h1>

      <div className="bg-slate-800 rounded-2xl overflow-hidden mb-4">
        <Row label="Name" value={member.name} />
        <Row label="Email" value={member.email} />
        <Row label="Membership No." value={member.membership_number} />
        {member.membership_tier && (
          <Row label="Tier" value={member.membership_tier} />
        )}
      </div>

      <button
        onClick={signOut}
        className="w-full bg-slate-800 hover:bg-slate-700 text-red-400 font-semibold py-4 rounded-2xl transition-colors"
      >
        Sign out
      </button>
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700 last:border-0">
      <span className="text-slate-400 text-sm">{label}</span>
      <span className="text-white text-sm">{value}</span>
    </div>
  )
}
