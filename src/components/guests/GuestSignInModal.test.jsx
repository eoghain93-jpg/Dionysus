import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import GuestSignInModal from './GuestSignInModal'
import { signInGuests, fetchGuestVisits } from '../../lib/guests'
import { searchMembersByName } from '../../lib/members'
import { openDrawer } from '../../lib/starPrinter'

vi.mock('../../lib/guests', async (importOriginal) => ({
  ...(await importOriginal()),
  signInGuests: vi.fn(),
  fetchGuestVisits: vi.fn(),
}))
vi.mock('../../lib/members', () => ({ searchMembersByName: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../../lib/starPrinter', () => ({ openDrawer: vi.fn() }))
vi.mock('../../stores/sessionStore', () => ({
  useSessionStore: () => ({ activeStaff: { id: 'staff-1', name: 'Kev' } }),
}))

const bob = { id: 'member-1', name: 'Bob Jones', membership_number: 'M0001' }

function setDob(i, value) {
  const input = screen.getByLabelText(`Guest ${i} date of birth`)
  fireEvent.change(input, { target: { value } })
  fireEvent.blur(input)
}

beforeEach(() => {
  vi.clearAllMocks()
  signInGuests.mockResolvedValue('order-1')
  fetchGuestVisits.mockResolvedValue(0)
  openDrawer.mockResolvedValue()
  searchMembersByName.mockResolvedValue([bob])
})

describe('GuestSignInModal', () => {
  it('requires a member before signing in', async () => {
    render(<GuestSignInModal onClose={vi.fn()} onSaved={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('Guest 1 name'), 'Jane Doe')
    setDob(1, '1990-05-01')
    await userEvent.click(screen.getByRole('button', { name: /Cash/ }))
    expect(screen.getByRole('alert')).toHaveTextContent('Select the member')
    expect(signInGuests).not.toHaveBeenCalled()
  })

  it('requires a date of birth for every guest', async () => {
    render(<GuestSignInModal initialMember={bob} onClose={vi.fn()} onSaved={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('Guest 1 name'), 'Jane Doe')
    await userEvent.click(screen.getByRole('button', { name: /Card/ }))
    expect(screen.getByRole('alert')).toHaveTextContent('date of birth')
    expect(signInGuests).not.toHaveBeenCalled()
  })

  it('searches for the member, charges £2 per guest by cash and opens the drawer', async () => {
    const onSaved = vi.fn()
    render(<GuestSignInModal onClose={vi.fn()} onSaved={onSaved} />)

    await userEvent.type(screen.getByPlaceholderText('Search member name'), 'Bob')
    await userEvent.click(await screen.findByRole('button', { name: /Bob Jones/ }))

    await userEvent.type(screen.getByLabelText('Guest 1 name'), 'Jane Doe')
    setDob(1, '1990-05-01')
    await userEvent.click(screen.getByRole('button', { name: /Add another guest/ }))
    await userEvent.type(screen.getByLabelText('Guest 2 name'), 'John Smith')
    setDob(2, '1985-03-03')

    expect(screen.getByText('£4.00')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Cash/ }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(signInGuests).toHaveBeenCalledWith(
      [{ name: 'Jane Doe', date_of_birth: '1990-05-01' }, { name: 'John Smith', date_of_birth: '1985-03-03' }],
      'member-1', 'cash', 'staff-1',
    )
    expect(openDrawer).toHaveBeenCalled()
  })

  it('does not open the drawer for card', async () => {
    const onSaved = vi.fn()
    render(<GuestSignInModal initialMember={bob} onClose={vi.fn()} onSaved={onSaved} />)
    await userEvent.type(screen.getByLabelText('Guest 1 name'), 'Jane Doe')
    setDob(1, '1990-05-01')
    await userEvent.click(screen.getByRole('button', { name: /Card/ }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(signInGuests).toHaveBeenCalledWith([{ name: 'Jane Doe', date_of_birth: '1990-05-01' }], 'member-1', 'card', 'staff-1')
    expect(openDrawer).not.toHaveBeenCalled()
  })

  it('shows the visit count and blocks a guest who has used all 3 visits', async () => {
    fetchGuestVisits.mockResolvedValue(3)
    render(<GuestSignInModal initialMember={bob} onClose={vi.fn()} onSaved={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('Guest 1 name'), 'Jane Doe')
    setDob(1, '1990-05-01')

    expect(await screen.findByText(/must join as a member/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Cash/ }))
    expect(screen.getByRole('alert')).toHaveTextContent('need to join as a member')
    expect(signInGuests).not.toHaveBeenCalled()
  })

  it('shows which visit this is for a returning guest', async () => {
    fetchGuestVisits.mockResolvedValue(1)
    render(<GuestSignInModal initialMember={bob} onClose={vi.fn()} onSaved={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('Guest 1 name'), 'Jane Doe')
    setDob(1, '1990-05-01')
    expect(await screen.findByText('Visit 2 of 3 this year')).toBeInTheDocument()
  })

  it('shows the server error when sign-in is refused', async () => {
    signInGuests.mockRejectedValue({ message: 'Jane Doe is already signed in tonight' })
    render(<GuestSignInModal initialMember={bob} onClose={vi.fn()} onSaved={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('Guest 1 name'), 'Jane Doe')
    setDob(1, '1990-05-01')
    await userEvent.click(screen.getByRole('button', { name: /Card/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('already signed in tonight')
  })
})
