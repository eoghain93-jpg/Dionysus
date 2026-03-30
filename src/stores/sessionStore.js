import { create } from 'zustand'

export const useSessionStore = create((set) => ({
  activeStaff: null,

  // Only store the minimum fields — never persist pin_hash or other sensitive data
  setActiveStaff: (member) =>
    set({ activeStaff: { id: member.id, name: member.name } }),

  clearSession: () => set({ activeStaff: null }),
}))
