import {
  signInGuests, fetchGuestsForDate, fetchGuestVisits, fetchGuestRecords,
  guestNameKey, visitsInLastYear,
} from './guests'
import { supabase } from './supabase'

vi.mock('./supabase', async () => {
  const { createSupabaseMock } = await import('../test/supabaseQueryMock')
  return { supabase: createSupabaseMock() }
})

beforeEach(() => supabase.__reset())

describe('guestNameKey', () => {
  it('ignores case and extra whitespace', () => {
    expect(guestNameKey('  Jane   DOE ')).toBe('jane doe')
  })
})

describe('visitsInLastYear', () => {
  it('counts only sign-ins in the rolling 12 months', () => {
    const now = new Date('2026-10-30T20:00:00Z')
    expect(visitsInLastYear([
      '2026-10-01T20:00:00Z',
      '2025-11-01T20:00:00Z',
      '2025-10-29T20:00:00Z', // just over a year ago
    ], now)).toBe(2)
  })
})

describe('signInGuests', () => {
  it('calls the sign_in_guests RPC with the trimmed party', async () => {
    supabase.rpc.mockResolvedValueOnce({ data: 'order-1', error: null })

    const result = await signInGuests(
      [{ name: ' Jane Doe ', date_of_birth: '1990-05-01' }, { name: '', date_of_birth: '' }],
      'member-1', 'cash', 'staff-1',
    )

    expect(result).toBe('order-1')
    expect(supabase.rpc).toHaveBeenCalledWith('sign_in_guests', {
      p_member_id: 'member-1',
      p_guests: [{ name: 'Jane Doe', date_of_birth: '1990-05-01' }],
      p_payment_method: 'cash',
      p_staff_id: 'staff-1',
      p_till_id: 'till-1',
    })
  })

  it('rejects when no guest names are given', async () => {
    await expect(signInGuests([{ name: '  ', date_of_birth: '' }], 'member-1', 'cash', 'staff-1'))
      .rejects.toThrow('Enter at least one guest name')
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it('rejects a guest without a date of birth', async () => {
    await expect(signInGuests([{ name: 'Jane', date_of_birth: '' }], 'member-1', 'cash', 'staff-1'))
      .rejects.toThrow('date of birth')
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it('rejects when no member is signing them in', async () => {
    await expect(signInGuests([{ name: 'Jane', date_of_birth: '1990-05-01' }], null, 'cash', 'staff-1'))
      .rejects.toThrow('Select the member')
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it('throws the server error, e.g. visit limit reached', async () => {
    const err = { message: 'Jane Doe has already visited 3 times in the last 12 months' }
    supabase.rpc.mockResolvedValueOnce({ data: null, error: err })
    await expect(signInGuests([{ name: 'Jane Doe', date_of_birth: '1990-05-01' }], 'member-1', 'card', 'staff-1'))
      .rejects.toEqual(err)
  })
})

describe('fetchGuestVisits', () => {
  it('looks the guest up by name key + DOB and counts recent visits', async () => {
    const recent = new Date(Date.now() - 7 * 864e5).toISOString()
    supabase.__configure({ guests: { data: { id: 'g1', guest_signins: [{ created_at: recent }, { created_at: '2020-01-01T20:00:00Z' }] } } })

    await expect(fetchGuestVisits(' Jane  Doe', '1990-05-01')).resolves.toBe(1)
    const chain = supabase.__chain('guests')
    expect(chain.eq).toHaveBeenCalledWith('name_key', 'jane doe')
    expect(chain.eq).toHaveBeenCalledWith('date_of_birth', '1990-05-01')
  })

  it('returns 0 for a new guest', async () => {
    supabase.__configure({ guests: { data: null } })
    await expect(fetchGuestVisits('New Person', '2000-01-01')).resolves.toBe(0)
  })
})

describe('fetchGuestRecords', () => {
  it('summarises visits per guest, sorted by name', async () => {
    supabase.__configure({ guests: { data: [
      { id: 'g2', name: 'Zoe', date_of_birth: '1995-02-02', guest_signins: [] },
      { id: 'g1', name: 'Amy', date_of_birth: '1990-01-01', guest_signins: [
        { created_at: '2026-10-01T20:00:00Z', member: { name: 'Bob' } },
        { created_at: '2026-10-20T20:00:00Z', member: { name: 'Kev' } },
        { created_at: '2024-01-01T20:00:00Z', member: { name: 'Bob' } },
      ] },
    ] } })

    const records = await fetchGuestRecords(new Date('2026-10-30T20:00:00Z'))
    expect(records.map(r => r.name)).toEqual(['Amy', 'Zoe'])
    expect(records[0]).toMatchObject({
      visitsThisYear: 2,
      totalVisits: 3,
      lastVisit: '2026-10-20T20:00:00Z',
      lastSignedInBy: 'Kev',
    })
    expect(records[1]).toMatchObject({ visitsThisYear: 0, lastVisit: null })
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
