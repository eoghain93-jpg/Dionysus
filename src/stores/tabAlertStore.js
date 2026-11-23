import { create } from 'zustand'
import { fetchTabAges } from '../lib/tabs'

// How many open tabs have gone too long without a payment. Drives the badge
// on the Tabs nav link so staff see it from any screen.
export const useTabAlertStore = create((set) => ({
  overdueCount: 0,

  setOverdueCount: (overdueCount) => set({ overdueCount }),

  // Best effort: offline or mid-deploy the badge just keeps its last value.
  refresh: async () => {
    try {
      const ages = await fetchTabAges()
      set({ overdueCount: Object.values(ages).filter(a => a.overdue).length })
    } catch (err) {
      console.error('Failed to refresh overdue tabs:', err)
    }
  },
}))
