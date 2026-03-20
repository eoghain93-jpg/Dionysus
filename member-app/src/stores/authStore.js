import { create } from 'zustand'
import { supabase } from '../lib/supabase'

export const useAuthStore = create((set) => ({
  session: null,
  member: null,
  loading: true,

  init: async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (session) {
      const member = await fetchMember(session.user.id)
      set({ session, member, loading: false })
    } else {
      set({ session: null, member: null, loading: false })
    }

    supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session) {
        const member = await fetchMember(session.user.id)
        set({ session, member })
      } else {
        set({ session: null, member: null })
      }
    })
  },

  signOut: async () => {
    await supabase.auth.signOut()
    set({ session: null, member: null })
  },
}))

async function fetchMember(authUserId) {
  const { data } = await supabase
    .from('members')
    .select('id, name, membership_number, membership_tier, tab_balance, email')
    .eq('auth_user_id', authUserId)
    .single()
  return data
}
