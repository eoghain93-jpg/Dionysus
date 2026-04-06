import { create } from 'zustand'

export const useToastStore = create((set) => ({
  toasts: [],

  addToast: (message, type = 'error') => {
    const id = Date.now() + Math.random()
    set(state => ({ toasts: [...state.toasts, { id, message, type }] }))
    setTimeout(() => {
      set(state => ({ toasts: state.toasts.filter(t => t.id !== id) }))
    }, 4000)
  },

  removeToast: (id) =>
    set(state => ({ toasts: state.toasts.filter(t => t.id !== id) })),
}))
