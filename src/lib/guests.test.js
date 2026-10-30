import { signInGuests, fetchGuestsForDate } from './guests'
import { supabase } from './supabase'

vi.mock('./supabase', async () => {
  const { createSupabaseMock } = await import('../test/supabaseQueryMock')
  return { supabase: createSupabaseMock() }
})

beforeEach(() => supabase.__reset())

describe('signInGuests', () => {
  it('inserts one guest_signins row per non-blank name', async () => {
    await signInGuests([' Jane Doe ', '', 'John Smith'], 'member-1', 'staff-1')

    expect(supabase.from).toHaveBeenCalledWith('guest_signins')
    expect(supabase.__chain('guest_signins').insert).toHaveBeenCalledWith([
      { guest_name: 'Jane Doe', member_id: 'member-1', staff_id: 'staff-1', till_id: 'till-1' },
      { guest_name: 'John Smith', member_id: 'member-1', staff_id: 'staff-1', till_id: 'till-1' },
    ])
  })

  it('rejects when no guest names are given', async () => {
    await expect(signInGuests(['  '], 'member-1', 'staff-1')).rejects.toThrow('Enter at least one guest name')
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('rejects when no member is signing them in', async () => {
    await expect(signInGuests(['Jane'], null, 'staff-1')).rejects.toThrow('Select the member')
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('throws if supabase returns an error', async () => {
    supabase.__configure({ guest_signins: { error: { message: 'db error' } } })
    await expect(signInGuests(['Jane'], 'member-1', 'staff-1')).rejects.toEqual({ message: 'db error' })
  })
})

describe('fetchGuestsForDate', () => {
  it('queries the trading day window and returns rows', async () => {
    const rows = [{ id: 'g1', guest_name: 'Jane', created_at: '2026-10-30T20:00:00Z', member: { name: 'Bob' } }]
    supabase.__configure({ guest_signins: { data: rows } })

    await expect(fetchGuestsForDate('2026-10-30')).resolves.toEqual(rows)
    const chain = supabase.__chain('guest_signins')
    expect(chain.gte).toHaveBeenCalledWith('created_at', '2026-10-30T06:00:00')
    expect(chain.lt).toHaveBeenCalledWith('created_at', '2026-10-31T06:00:00')
  })
})
