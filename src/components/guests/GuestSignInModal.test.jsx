import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import GuestSignInModal from './GuestSignInModal'
import { signInGuests } from '../../lib/guests'
import { searchMembersByName } from '../../lib/members'

vi.mock('../../lib/guests', () => ({ signInGuests: vi.fn() }))
vi.mock('../../lib/members', () => ({ searchMembersByName: vi.fn() }))
vi.mock('../../stores/sessionStore', () => ({
  useSessionStore: () => ({ activeStaff: { id: 'staff-1', name: 'Kev' } }),
}))

const bob = { id: 'member-1', name: 'Bob Jones', membership_number: 'M0001' }

beforeEach(() => {
  vi.clearAllMocks()
  signInGuests.mockResolvedValue()
  searchMembersByName.mockResolvedValue([bob])
})

describe('GuestSignInModal', () => {
  it('requires a member before signing in', async () => {
    render(<GuestSignInModal onClose={vi.fn()} onSaved={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('Guest 1 name'), 'Jane Doe')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Select the member')
    expect(signInGuests).not.toHaveBeenCalled()
  })

  it('searches for the member and signs in multiple guests', async () => {
    const onSaved = vi.fn()
    render(<GuestSignInModal onClose={vi.fn()} onSaved={onSaved} />)

    await userEvent.type(screen.getByPlaceholderText('Search member name'), 'Bob')
    await userEvent.click(await screen.findByRole('button', { name: /Bob Jones/ }))

    await userEvent.type(screen.getByLabelText('Guest 1 name'), 'Jane Doe')
    await userEvent.click(screen.getByRole('button', { name: /Add another guest/ }))
    await userEvent.type(screen.getByLabelText('Guest 2 name'), 'John Smith')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(signInGuests).toHaveBeenCalledWith(['Jane Doe', 'John Smith'], 'member-1', 'staff-1')
  })

  it('pre-fills the member identified on the till', async () => {
    render(<GuestSignInModal initialMember={bob} onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(screen.getByText('Bob Jones')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Guest 1 name'), 'Jane Doe')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(signInGuests).toHaveBeenCalledWith(['Jane Doe'], 'member-1', 'staff-1'))
  })
})
