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
    <div className="ui-page">
      {/* Page header */}
      <div className="ui-page-header">
        <h1 className="ui-title">Members</h1>
        <button onClick={openAdd} className="ui-btn ui-btn-primary w-full sm:w-auto">
          <UserPlus size={20} aria-hidden="true" />
          Add Member
        </button>
      </div>

      {/* Search */}
      <div className="relative shrink-0">
        <Search
          size={20}
          aria-hidden="true"
          className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
        />
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, membership number, phone or email…"
          aria-label="Search members"
          className="ui-input min-h-[56px] pl-12 text-[17px]"
        />
      </div>

      {/* Member list */}
      <div className="ui-card flex-1 min-h-[160px] overflow-auto">
        {loading ? (
          <p className="ui-empty">Loading members…</p>
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
