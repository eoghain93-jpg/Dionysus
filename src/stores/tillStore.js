import { create } from 'zustand'

export const useTillStore = create((set, get) => ({
  orderItems: [],
  activeMember: null,

  setActiveMember: (member) => set({ activeMember: member }),
  clearMember: () => set({ activeMember: null }),

  addItem: (product) => {
    const { orderItems, activeMember } = get()
    const price = activeMember ? product.member_price : product.standard_price
    const existing = orderItems.find(i => i.product_id === product.id)
    if (existing) {
      set({
        orderItems: orderItems.map(i =>
          i.product_id === product.id
            ? { ...i, quantity: i.quantity + 1, subtotal: (i.quantity + 1) * price }
            : i
        )
      })
    } else {
      set({
        orderItems: [...orderItems, {
          product_id: product.id,
          name: product.name,
          quantity: 1,
          unit_price: price,
          member_price_applied: !!activeMember,
          subtotal: price,
        }]
      })
    }
  },

  removeItem: (product_id) =>
    set(state => ({ orderItems: state.orderItems.filter(i => i.product_id !== product_id) })),

  updateQuantity: (product_id, quantity) => {
    if (quantity <= 0) {
      set(state => ({ orderItems: state.orderItems.filter(i => i.product_id !== product_id) }))
    } else {
      set(state => ({
        orderItems: state.orderItems.map(i =>
          i.product_id === product_id
            ? { ...i, quantity, subtotal: quantity * i.unit_price }
            : i
        )
      }))
    }
  },

  clearOrder: () => set({ orderItems: [], activeMember: null }),

  getTotal: () => get().orderItems.reduce((sum, i) => sum + i.subtotal, 0),
}))
