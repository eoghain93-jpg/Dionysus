import { recordPrizeWin, fetchPrizeWinsForDate } from './prizeWins'
import { supabase } from './supabase'

vi.mock('./supabase', () => ({
  supabase: {
    from: vi.fn(),
  },
}))

beforeEach(() => vi.clearAllMocks())

describe('recordPrizeWin', () => {
  it('inserts a prize_wins row with machine identifier', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null })
    supabase.from.mockReturnValue({ insert })

    await recordPrizeWin(20.00, '1', 'staff-123')

    expect(supabase.from).toHaveBeenCalledWith('prize_wins')
    expect(insert).toHaveBeenCalledWith({
      amount: 20.00,
      machine: '1',
      staff_id: 'staff-123',
      till_id: 'till-1',
    })
  })

  it('throws if supabase returns an error', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { message: 'db error' } })
    supabase.from.mockReturnValue({ insert })

    await expect(recordPrizeWin(20.00, '1', 'staff-123')).rejects.toThrow('db error')
  })
})

describe('fetchPrizeWinsForDate', () => {
  it('returns total plus per-machine breakdown', async () => {
    const select = vi.fn().mockReturnThis()
    const gte = vi.fn().mockReturnThis()
    const lte = vi.fn().mockResolvedValue({
      data: [
        { amount: 10, machine: '1' },
        { amount: 5,  machine: '1' },
        { amount: 15, machine: '2' },
      ],
      error: null,
    })
    supabase.from.mockReturnValue({ select, gte, lte })

    const result = await fetchPrizeWinsForDate('2026-04-29')
    expect(result).toEqual({ total: 30, machine1: 15, machine2: 15 })
  })

  it('returns zeroes when no rows for date', async () => {
    const select = vi.fn().mockReturnThis()
    const gte = vi.fn().mockReturnThis()
    const lte = vi.fn().mockResolvedValue({ data: [], error: null })
    supabase.from.mockReturnValue({ select, gte, lte })

    const result = await fetchPrizeWinsForDate('2026-04-29')
    expect(result).toEqual({ total: 0, machine1: 0, machine2: 0 })
  })
})
