import Dexie from 'dexie'

export const db = new Dexie('ClubEPOS')

db.version(1).stores({
  products: 'id, name, category, active',
  members: 'id, membership_number, name, membership_tier, active',
  pendingOrders: '++localId, createdAt',
  pendingStockMovements: '++localId, createdAt',
})

// v2: drop the 'active' indexes. `active` is a boolean and IndexedDB cannot
// index boolean keys, so rows never appeared in those indexes and offline
// reads that used them matched nothing. Reads now use .filter() — keeping
// the dead indexes around invites the same bug back.
db.version(2).stores({
  products: 'id, name, category',
  members: 'id, membership_number, name, membership_tier',
})
