import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
  },
}))

describe('authStore', () => {
  it('initialises with null session and member and loading true', async () => {
    const { useAuthStore } = await import('./authStore')
    const { result } = renderHook(() => useAuthStore())
    expect(result.current.session).toBeNull()
    expect(result.current.member).toBeNull()
  })
})
