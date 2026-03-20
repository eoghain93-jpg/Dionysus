import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import MyCardPage from './MyCardPage'

vi.mock('../stores/authStore', () => ({
  useAuthStore: () => ({
    member: {
      id: 'uuid-1',
      name: 'Jane Smith',
      membership_number: 'M0042',
      membership_tier: 'member',
    },
  }),
}))

vi.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value }) => <div data-testid="qrcode">{value}</div>,
}))

describe('MyCardPage', () => {
  it('displays member name and membership number', () => {
    render(<MyCardPage />)
    expect(screen.getByText('Jane Smith')).toBeInTheDocument()
    expect(screen.getAllByText('M0042').length).toBeGreaterThan(0)
  })

  it('renders a QR code with the membership number', () => {
    render(<MyCardPage />)
    const qr = screen.getByTestId('qrcode')
    expect(qr.textContent).toBe('M0042')
  })
})
