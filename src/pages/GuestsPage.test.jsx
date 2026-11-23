import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import GuestsPage from './GuestsPage'
import { fetchGuestsForDate } from '../lib/guests'
import { logEvent } from '../lib/audit/log'

vi.mock('../lib/audit/log', () => ({ logEvent: vi.fn() }))
vi.mock('../lib/guests', () => ({ fetchGuestsForDate: vi.fn() }))
vi.mock('../lib/tradingDay', () => ({ tradingTodayISO: () => '2026-03-30' }))
vi.mock('../components/guests/GuestSignInModal', () => ({
  default: ({ onSaved }) => <button onClick={onSaved}>Mock guest saved</button>,
}))

const GUESTS = [
  { id: 'g1', guest_name: 'Pat Visitor', created_at: '2026-03-30T20:00:00Z', member: { name: 'Alice', membership_number: 'M0001' } },
  { id: 'g2', guest_name: 'Sam Visitor', created_at: '2026-03-30T20:05:00Z', member: { name: 'Alice', membership_number: 'M0001' } },
]

beforeEach(() => {
  vi.clearAllMocks()
  fetchGuestsForDate.mockResolvedValue(GUESTS)
})

describe('GuestsPage — audit events', () => {
  it('logs guests.viewed for the date once the guest book is on screen', async () => {
    let finish
    fetchGuestsForDate.mockReturnValue(new Promise(resolve => { finish = resolve }))
    render(<GuestsPage />)
    expect(logEvent).not.toHaveBeenCalled()
    finish(GUESTS)
    await screen.findByText('Pat Visitor')
    expect(logEvent.mock.calls).toEqual([
      ['guests.viewed', { date: '2026-03-30', guests: 2 }],
    ])
  })

  it('logs again when another date is shown', async () => {
    render(<GuestsPage />)
    await screen.findByText('Pat Visitor')
    fetchGuestsForDate.mockResolvedValue([])
    fireEvent.change(screen.getByLabelText('Select guest book date'), { target: { value: '2026-03-14' } })
    await screen.findByText(/no guests signed in on 2026-03-14/i)
    expect(logEvent.mock.calls).toEqual([
      ['guests.viewed', { date: '2026-03-30', guests: 2 }],
      ['guests.viewed', { date: '2026-03-14', guests: 0 }],
    ])
  })

  it('logs nothing when the guest book fails to load', async () => {
    fetchGuestsForDate.mockRejectedValue(new Error('permission denied'))
    render(<GuestsPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('permission denied')
    expect(logEvent).not.toHaveBeenCalled()
  })

  it('never puts guest or member names in the event', async () => {
    render(<GuestsPage />)
    await screen.findByText('Pat Visitor')
    await waitFor(() => expect(logEvent).toHaveBeenCalled())
    const logged = JSON.stringify(logEvent.mock.calls)
    expect(logged).not.toContain('Visitor')
    expect(logged).not.toContain('Alice')
  })
})
