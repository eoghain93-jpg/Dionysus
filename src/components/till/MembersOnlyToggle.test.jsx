import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import MembersOnlyToggle from './MembersOnlyToggle'
import { useTillStore } from '../../stores/tillStore'
import { logEvent } from '../../lib/audit/log'

vi.mock('../../lib/audit/log', () => ({ logEvent: vi.fn() }))

const mode = () => useTillStore.getState().membersOnlyMode

beforeEach(() => {
  useTillStore.setState({ orderItems: [], activeMember: null, membersOnlyMode: false })
  vi.clearAllMocks()
})

describe('MembersOnlyToggle', () => {
  it('turning event mode on is logged once it is confirmed', () => {
    render(<MembersOnlyToggle />)
    fireEvent.click(screen.getByRole('button', { name: /start members-only event mode/i }))
    // the confirmation is showing — nothing has changed yet
    expect(mode()).toBe(false)
    expect(logEvent).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Start event mode' }))
    expect(mode()).toBe(true)
    expect(logEvent.mock.calls).toEqual([
      ['pricing.members_only_mode_on', {}, { severity: 1 }],
    ])
  })

  it('turning event mode off is logged once it is confirmed', () => {
    useTillStore.setState({ membersOnlyMode: true })
    render(<MembersOnlyToggle />)
    fireEvent.click(screen.getByRole('button', { name: 'End event mode' }))
    expect(logEvent).not.toHaveBeenCalled()

    // the banner button and the dialog's confirm share a name; the dialog's is last
    const buttons = screen.getAllByRole('button', { name: 'End event mode' })
    fireEvent.click(buttons[buttons.length - 1])
    expect(mode()).toBe(false)
    expect(logEvent.mock.calls).toEqual([
      ['pricing.members_only_mode_off', {}, { severity: 1 }],
    ])
  })

  it('cancelling the confirmation changes nothing and logs nothing', () => {
    render(<MembersOnlyToggle />)
    fireEvent.click(screen.getByRole('button', { name: /start members-only event mode/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(mode()).toBe(false)
    expect(logEvent).not.toHaveBeenCalled()
  })
})
