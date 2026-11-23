import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SwitchUserModal from './SwitchUserModal'

const { mockInvoke, mockFrom } = vi.hoisted(() => ({ mockInvoke: vi.fn(), mockFrom: vi.fn() }))

vi.mock('../../lib/supabase', () => ({
  supabase: { from: mockFrom, functions: { invoke: mockInvoke } },
}))

function staffQuery(result) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue(result),
  }
}

async function pickAliceAndEnterPin() {
  fireEvent.click(await screen.findByRole('button', { name: 'Alice' }))
  for (const d of '1234') fireEvent.click(screen.getByRole('button', { name: d }))
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFrom.mockReturnValue(staffQuery({ data: [{ id: 's1', name: 'Alice' }], error: null }))
})

describe('SwitchUserModal', () => {
  it('shows a lockout countdown, not "Incorrect PIN", when the PIN is locked', async () => {
    mockInvoke.mockResolvedValue({ data: { valid: false, reason: 'locked', retryAfterSeconds: 90 }, error: null })
    render(<SwitchUserModal onClose={vi.fn()} />)
    await pickAliceAndEnterPin()
    expect(await screen.findByRole('status')).toHaveTextContent(/PIN locked.*Try again in 1:30/)
    expect(screen.queryByText('Incorrect PIN')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '5' })).toBeDisabled()
  })

  it('still says "Incorrect PIN" for a plain wrong PIN', async () => {
    mockInvoke.mockResolvedValue({ data: { valid: false }, error: null })
    render(<SwitchUserModal onClose={vi.fn()} />)
    await pickAliceAndEnterPin()
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect PIN')
  })

  it('says so when the staff list cannot be loaded', async () => {
    mockFrom.mockReturnValue(staffQuery({ data: null, error: { message: 'offline' } }))
    render(<SwitchUserModal onClose={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load staff/i)
  })
})
