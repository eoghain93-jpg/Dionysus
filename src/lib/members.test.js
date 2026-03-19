import { describe, it, expect, vi, beforeEach } from 'vitest'
import { upsertMember } from './members'

vi.mock('./supabase', () => ({
  supabase: {
    from: vi.fn(),
    functions: { invoke: vi.fn() },
  },
}))

vi.mock('./db', () => ({
  db: { members: { put: vi.fn() } },
}))

describe('upsertMember', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('invites member via edge function when email provided on create', async () => {
    const { supabase } = await import('./supabase')
    const mockMember = { id: 'uuid-1', name: 'Test', membership_number: 'M0001', email: 'test@test.com' }

    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: mockMember, error: null }),
      count: 0,
      head: true,
    })
    supabase.functions.invoke.mockResolvedValue({ error: null })

    await upsertMember({ name: 'Test', email: 'test@test.com' })
    // Allow the fire-and-forget promise to resolve
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(supabase.functions.invoke).toHaveBeenCalledWith('invite-member', {
      body: { member_id: 'uuid-1', email: 'test@test.com' },
    })
  })

  it('does not invite when no email provided on create', async () => {
    const { supabase } = await import('./supabase')
    const mockMember = { id: 'uuid-2', name: 'NoEmail', membership_number: 'M0002' }

    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: mockMember, error: null }),
      count: 0,
      head: true,
    })
    supabase.functions.invoke.mockResolvedValue({ error: null })

    await upsertMember({ name: 'NoEmail' })
    // Flush microtask queue for consistency with fire-and-forget pattern
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(supabase.functions.invoke).not.toHaveBeenCalled()
  })

  it('does not invite when updating existing member (id present)', async () => {
    const { supabase } = await import('./supabase')
    const mockMember = { id: 'uuid-3', name: 'Existing', email: 'existing@test.com' }

    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: mockMember, error: null }),
    })
    supabase.functions.invoke.mockResolvedValue({ error: null })

    await upsertMember({ id: 'uuid-3', name: 'Existing', email: 'existing@test.com' })

    expect(supabase.functions.invoke).not.toHaveBeenCalled()
  })
})
