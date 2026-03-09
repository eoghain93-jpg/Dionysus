import { describe, it, expect } from 'vitest'
import { db } from './db'

describe('offline db', () => {
  it('has required tables', () => {
    const tableNames = db.tables.map(t => t.name)
    expect(tableNames).toContain('products')
    expect(tableNames).toContain('members')
    expect(tableNames).toContain('pendingOrders')
    expect(tableNames).toContain('pendingStockMovements')
  })
})
