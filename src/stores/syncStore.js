import { create } from 'zustand'

export const useSyncStore = create((set) => ({
  isOnline: navigator.onLine,
  pendingCount: 0,

  setOnline: (isOnline) => set({ isOnline }),
  setPendingCount: (pendingCount) => set({ pendingCount }),
}))
