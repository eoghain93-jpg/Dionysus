import Dexie from 'dexie'

export const db = new Dexie('ClubEPOS')

db.version(1).stores({
  products: 'id, name, category, active',
  members: 'id, membership_number, name, membership_tier, active',
  pendingOrders: '++localId, createdAt',
  pendingStockMovements: '++localId, createdAt',
})
