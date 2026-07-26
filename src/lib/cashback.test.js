import { recordCashback, fetchCashbackForDate } from './cashback'
import { supabase } from './supabase'

vi.mock('./supabase', () => ({
  supabase: {
    from: vi.fn(),
  },
}))

beforeEach(() => vi.clearAllMocks())

describe('recordCashback', () => {
  it('inserts a cashback_transactions row', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null })
    supabase.from.mockReturnValue({ insert })

    await recordCashback(10.00, 'staff-123')

    expect(supabase.from).toHaveBeenCalledWith('cashback_transactions')
    expect(insert).toHaveBeenCalledWith({
      amount: 10.00,
      staff_id: 'staff-123',
      till_id: 'till-1',
    })
  })

  it('throws if supabase returns an error', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { message: 'db error' } })
    supabase.from.mockReturnValue({ insert })

    await expect(recordCashback(10.00, 'staff-123')).rejects.toThrow('db error')
  })
})

describe('fetchCashbackForDate', () => {
  it('returns total cashback amount for a date', async () => {
    const select = vi.fn().mockReturnThis()
    const gte = vi.fn().mockReturnThis()
    const lt = vi.fn().mockResolvedValue({
      data: [{ amount: 10 }, { amount: 5 }],
      error: null,
    })
    supabase.from.mockReturnValue({ select, gte, lt })

    const result = await fetchCashbackForDate('2026-04-02')
    // Trading-day window: 06:00 on the date to 06:00 the next morning
    expect(gte).toHaveBeenCalledWith('created_at', '2026-04-02T06:00:00')
    expect(lt).toHaveBeenCalledWith('created_at', '2026-04-03T06:00:00')
    expect(result).toBe(15)
  })
})
