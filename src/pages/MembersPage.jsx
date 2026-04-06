import { useState, useEffect, useCallback } from 'react'
import { fetchMembers } from '../lib/members'
import { Search, UserPlus } from '../lib/icons'
import MemberList from '../components/members/MemberList'
import MemberProfile from '../components/members/MemberProfile'
import MemberFormModal from '../components/members/MemberFormModal'

export default function MembersPage() {
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  // null = closed, undefined = open (add), object = open (edit)
  const [formModal, setFormModal] = useState(undefined)
  // null = closed, object = viewing
  const [profileMember, setProfileMember] = useState(null)

  const loadMembers = useCallback(() => {
    setLoading(true)
    fetchMembers()
      .then(setMembers)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    loadMembers()
  }, [loadMembers])

  // Search filtering: name, membership_number, phone, email
  const filtered = members.filter(m => {
    if (!search.trim()) return true
    const q = search.trim().toLowerCase()
    return (
      m.name?.toLowerCase().includes(q) ||
      m.membership_number?.toLowerCase().includes(q) ||
      m.phone?.toLowerCase().includes(q) ||
      m.email?.toLowerCase().includes(q)
    )
  })

  function openAdd() {
    setFormModal(null)
  }

  function openEdit(member) {
    setFormModal(member)
  }

  function closeForm() {
    setFormModal(undefined)
  }

  function handleFormSaved() {
    closeForm()
    loadMembers()
    // If we were editing the currently viewed member, refresh it
    if (profileMember) {
      fetchMembers()
        .then(data => {
          const updated = data.find(m => m.id === profileMember.id)
          if (updated) setProfileMember(updated)
        })
        .catch(console.error)
    }
  }

  function handleTabSettled() {
    loadMembers()
    // Refresh profile member with updated balance
    fetchMembers()
      .then(data => {
        if (profileMember) {
          const updated = data.find(m => m.id === profileMember.id)
          if (updated) setProfileMember(updated)
        }
      })
      .catch(console.error)
  }

  return (
    <div className="flex flex-col h-full min-h-0 p-4 gap-4 overflow-auto">
      {/* Page header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1
          className="text-2xl font-bold text-white"
        >
          Members
        </h1>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 px-4 min-h-[44px] rounded-xl bg-[#22C55E] hover:bg-green-400 text-slate-900 font-bold text-sm transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
        >
          <UserPlus size={16} aria-hidden="true" />
          Add Member
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search
          size={16}
          aria-hidden="true"
          className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
        />
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, membership number, phone or email…"
          aria-label="Search members"
          className="w-full bg-[#0F172A] border border-slate-700 rounded-xl pl-9 pr-3 py-2 text-white placeholder-slate-500 min-h-[44px] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#020617]"
        />
      </div>

      {/* Member list */}
      <div className="flex-1 bg-[#0F172A] rounded-2xl border border-slate-700 overflow-hidden">
        {loading ? (
          <p className="text-slate-400 text-sm p-6 text-center">Loading members…</p>
        ) : (
          <MemberList
            members={filtered}
            onSelect={setProfileMember}
            onEdit={openEdit}
          />
        )}
      </div>

      {/* Member profile overlay */}
      {profileMember && (
        <MemberProfile
          member={profileMember}
          onClose={() => setProfileMember(null)}
          onEdit={member => {
            setProfileMember(null)
            openEdit(member)
          }}
          onSettleTab={handleTabSettled}
        />
      )}

      {/* Add / edit form modal */}
      {formModal !== undefined && (
        <MemberFormModal
          member={formModal}
          onClose={closeForm}
          onSaved={handleFormSaved}
        />
      )}
    </div>
  )
}
