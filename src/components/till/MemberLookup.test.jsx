import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import MemberLookup from './MemberLookup'
import { useTillStore } from '../../stores/tillStore'
import { findMemberByNumber, searchMembersByName } from '../../lib/members'
import { logEvent } from '../../lib/audit/log'

vi.mock('../../lib/audit/log', () => ({ logEvent: vi.fn() }))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    auth: { getSession: vi.fn() },
  },
}))

vi.mock('../../lib/members', () => ({
  findMemberByNumber: vi.fn().mockResolvedValue(null),
  searchMembersByName: vi.fn().mockResolvedValue([]),
}))

vi.mock('html5-qrcode', () => ({
  Html5QrcodeScanner: vi.fn().mockImplementation(() => ({
    render: vi.fn(),
    clear: vi.fn().mockResolvedValue(undefined),
  })),
}))

beforeEach(() => {
  useTillStore.setState({ orderItems: [], activeMember: null })
  vi.clearAllMocks()
  findMemberByNumber.mockResolvedValue(null)
  searchMembersByName.mockResolvedValue([])
})

const john = { id: 'm1', name: 'John', membership_number: 'M0001', phone: '07700 900123', pin_hash: 'SECRET' }
const attached = () => useTillStore.getState().activeMember
const input = () => screen.getByPlaceholderText(/member number/i)
const submit = () => fireEvent.click(screen.getByRole('button', { name: /find member/i }))

// A USB scanner "types" the card number as a fast burst, then Enter.
function scan(text) {
  for (const key of text) fireEvent.keyDown(window, { key })
  fireEvent.keyDown(window, { key: 'Enter' })
}

describe('MemberLookup', () => {
  it('renders search input when no member active', () => {
    render(<MemberLookup />)
    expect(screen.getByPlaceholderText(/member number/i)).toBeInTheDocument()
  })

  it('renders nothing when a member is active', () => {
    useTillStore.setState({ activeMember: { id: 'm1', name: 'John', membership_number: 'M0001' } })
    const { container } = render(<MemberLookup />)
    expect(container.firstChild).toBeNull()
  })
})

describe('MemberLookup — how the member got onto the sale', () => {
  it('a typed membership number is logged as method "number"', async () => {
    findMemberByNumber.mockResolvedValue(john)
    render(<MemberLookup />)
    fireEvent.change(input(), { target: { value: 'M0001' } })
    submit()
    await waitFor(() => expect(attached()).toEqual(john))
    expect(logEvent.mock.calls).toEqual([
      ['cart.member_attached', { member_id: 'm1', member_name: 'John', method: 'number' }],
    ])
  })

  it('a scanned card is logged as method "scan"', async () => {
    findMemberByNumber.mockResolvedValue(john)
    render(<MemberLookup />)
    scan('M0001')
    await waitFor(() => expect(attached()).toEqual(john))
    expect(findMemberByNumber).toHaveBeenCalledWith('M0001')
    expect(logEvent.mock.calls).toEqual([
      ['cart.member_attached', { member_id: 'm1', member_name: 'John', method: 'scan' }],
    ])
  })

  it('a scan that also submits the box (scanner types + Enter) is ONE scan, not a scan and a typed number', async () => {
    findMemberByNumber.mockResolvedValue(john)
    render(<MemberLookup />)
    fireEvent.change(input(), { target: { value: 'M0001' } })
    scan('M0001')
    submit()
    await waitFor(() => expect(findMemberByNumber).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(attached()).toEqual(john))
    expect(logEvent.mock.calls).toEqual([
      ['cart.member_attached', { member_id: 'm1', member_name: 'John', method: 'scan' }],
    ])
  })

  it('a name picked from the suggestions is logged as method "search"', async () => {
    searchMembersByName.mockResolvedValue([john, { id: 'm2', name: 'Johnny', membership_number: 'M0002' }])
    render(<MemberLookup />)
    fireEvent.change(input(), { target: { value: 'joh' } })
    fireEvent.click(await screen.findByRole('button', { name: /Johnny/ }))
    expect(attached().id).toBe('m2')
    expect(logEvent.mock.calls).toEqual([
      ['cart.member_attached', { member_id: 'm2', member_name: 'Johnny', method: 'search' }],
    ])
  })

  it('a single name match on submit is logged as method "search"', async () => {
    searchMembersByName.mockResolvedValue([john])
    render(<MemberLookup />)
    fireEvent.change(input(), { target: { value: 'john' } })
    // submit before the suggestion debounce fires
    submit()
    await waitFor(() => expect(attached()).toEqual(john))
    expect(logEvent.mock.calls).toEqual([
      ['cart.member_attached', { member_id: 'm1', member_name: 'John', method: 'search' }],
    ])
  })

  it('logs nothing when nobody is found', async () => {
    render(<MemberLookup />)
    fireEvent.change(input(), { target: { value: 'M9999' } })
    submit()
    expect(await screen.findByRole('alert')).toHaveTextContent('No member found')
    expect(attached()).toBeNull()
    expect(logEvent).not.toHaveBeenCalled()
  })

  it('logs the id and name only — never the member record', async () => {
    findMemberByNumber.mockResolvedValue(john)
    render(<MemberLookup />)
    fireEvent.change(input(), { target: { value: 'M0001' } })
    submit()
    await waitFor(() => expect(logEvent).toHaveBeenCalled())
    const logged = JSON.stringify(logEvent.mock.calls)
    expect(logged).not.toContain('SECRET')
    expect(logged).not.toContain('07700')
  })
})
