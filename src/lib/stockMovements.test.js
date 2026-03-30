import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./supabase', () => ({
  supabase: {
    from: vi.fn(),
  },
}))

import { supabase } from './supabase'
import {
  logWastage,
  logStaffDrink,
  fetchWastageForDate,
  fetchStaffDrinksForDate,
} from './stockMovements'

beforeEach(() => vi.clearAllMocks())

describe('logWastage', () => {
  it('inserts a wastage row with correct payload', async () => {
    const insertMock = vi.fn().mockResolvedValue({ error: null })
    supabase.from.mockReturnValue({ insert: insertMock })
    await logWastage('prod-1', 4, 'till-1')
    expect(supabase.from).toHaveBeenCalledWith('stock_movements')
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'wastage', product_id: 'prod-1', quantity: 4 })
    )
  })

  it('throws if insert fails', async () => {
    supabase.from.mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: { message: 'DB error' } }),
    })
    await expect(logWastage('prod-1', 4, 'till-1')).rejects.toThrow('DB error')
  })
})

describe('logStaffDrink', () => {
  it('inserts a staff_drink row with member_id', async () => {
    const insertMock = vi.fn().mockResolvedValue({ error: null })
    supabase.from.mockReturnValue({ insert: insertMock })
    await logStaffDrink('prod-1', 1, 'member-1', 'till-1')
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'staff_drink', member_id: 'member-1' })
    )
  })

  it('throws if insert fails', async () => {
    supabase.from.mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: { message: 'DB error' } }),
    })
    await expect(logStaffDrink('prod-1', 1, 'member-1', 'till-1')).rejects.toThrow('DB error')
  })
})

describe('fetchWastageForDate', () => {
  it('returns wastage rows with name and value', async () => {
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockResolvedValue({
        data: [{ quantity: 4, products: { name: 'Guinness', standard_price: 7.40 } }],
        error: null,
      }),
    })
    const result = await fetchWastageForDate('2026-03-30')
    expect(result).toEqual([{ name: 'Guinness', quantity: 4, value: 29.60 }])
  })

  it('returns empty array when no wastage', async () => {
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockResolvedValue({ data: [], error: null }),
    })
    const result = await fetchWastageForDate('2026-03-30')
    expect(result).toEqual([])
  })
})

describe('fetchStaffDrinksForDate', () => {
  it('groups staff drinks by member', async () => {
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockResolvedValue({
        data: [
          { quantity: 1, member_id: 'mem-1', products: { name: 'Guinness', standard_price: 7.40 }, members: { name: 'Dave' } },
          { quantity: 1, member_id: 'mem-1', products: { name: 'Carlsberg', standard_price: 6.00 }, members: { name: 'Dave' } },
        ],
        error: null,
      }),
    })
    const result = await fetchStaffDrinksForDate('2026-03-30')
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ name: 'Dave', items: 2, value: 13.40 })
  })

  it('returns empty array when no staff drinks', async () => {
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockResolvedValue({ data: [], error: null }),
    })
    const result = await fetchStaffDrinksForDate('2026-03-30')
    expect(result).toEqual([])
  })
})
