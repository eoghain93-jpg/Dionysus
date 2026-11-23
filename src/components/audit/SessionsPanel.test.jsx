import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import SessionsPanel from './SessionsPanel'

const at = (hour, minute = 0, day = 22) => new Date(2026, 10, day, hour, minute, 0).toISOString()
const session = (n, extra = {}) => ({
  id: `s${n}`, staff_id: `m${n}`, staff_name: `Person ${n}`, till_id: 'till-1', trust: 'pin',
  started_at: at(9, n), ended_at: at(13, 30 + n), end_reason: 'sign_out', ip: '203.0.113.10', ...extra,
})

describe('SessionsPanel', () => {
  it('shows who was signed in, where, from when to when, and how it ended', () => {
    render(<SessionsPanel sessions={[
      session(1, { staff_name: 'Sam Staff', started_at: at(9, 0), ended_at: at(13, 30), end_reason: 'close_day' }),
      session(2, { staff_name: 'Kim Newstarter', till_id: 'till-2', trust: 'claimed', started_at: at(22, 0, 21), ended_at: at(0, 45), end_reason: 'something_new' }),
      session(3, { staff_name: null, ended_at: null, end_reason: null, ip: null }),
    ]} />)
    const rows = within(screen.getByRole('region', { name: 'Who was signed in' })).getAllByRole('listitem')
    expect(rows).toHaveLength(3)

    expect(rows[0]).toHaveTextContent('Sam Staff')
    expect(rows[0]).toHaveTextContent('· Till 1')
    expect(rows[0]).toHaveTextContent('PIN checked')
    expect(rows[0]).toHaveTextContent('Sun 22 Nov, 09:00 to 13:30 (4 h 30 min) — day was closed')
    expect(rows[0]).toHaveTextContent('Network address 203.0.113.10')

    // ran past midnight: the end shows its own day; an unknown reason is still readable
    expect(rows[1]).toHaveTextContent('said to be')
    expect(rows[1]).toHaveTextContent('Sat 21 Nov, 22:00 to Sun 22 Nov, 00:45 (2 h 45 min) — something new')

    expect(rows[2]).toHaveTextContent('A staff member no longer on the list')
    expect(rows[2]).toHaveTextContent('still signed in')
    expect(rows[2]).not.toHaveTextContent('Network address')
  })

  it('shows the first few and offers the rest', () => {
    render(<SessionsPanel sessions={Array.from({ length: 11 }, (_, i) => session(i + 1))} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(8)

    fireEvent.click(screen.getByRole('button', { name: 'Show all 11' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(11)

    fireEvent.click(screen.getByRole('button', { name: 'Show fewer' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(8)
  })

  it('says when nobody was signed in, while loading, and when it could not load', () => {
    const { rerender } = render(<SessionsPanel sessions={[]} />)
    expect(screen.getByText('Nobody was signed in during these dates.')).toBeInTheDocument()

    rerender(<SessionsPanel sessions={[]} loading />)
    expect(screen.getByText('Loading sign-ins…')).toBeInTheDocument()
    expect(screen.queryByText('Nobody was signed in during these dates.')).not.toBeInTheDocument()

    rerender(<SessionsPanel sessions={[]} error="boom" />)
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load who was signed in: boom')
  })
})
