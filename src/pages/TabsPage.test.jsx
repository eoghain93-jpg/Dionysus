// src/pages/TabsPage.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import TabsPage from './TabsPage'

vi.mock('../lib/tabs', () => ({
  fetchOpenTabs: vi.fn(),
  fetchTabOrders: vi.fn(),
  adjustTabBalance: vi.fn(),
  removeOrderFromTab: vi.fn(),
}))

vi.mock('../lib/starPrinter', () => ({
  printTabsList: vi.fn(),
  printTabStatement: vi.fn(),
  getPrinterIp: vi.fn(),
}))

vi.mock('../lib/audit/log', () => ({ logEvent: vi.fn() }))

vi.mock('../components/members/SettleTabModal', () => ({
  default: ({ member, onClose, onSettled }) => (
    <div role="dialog">
      <span>Settle {member.name}</span>
      <button onClick={() => onSettled(Number(member.tab_balance))}>Confirm Settle Full</button>
      <button onClick={() => onSettled(5)}>Confirm Settle Partial</button>
      <button onClick={onClose}>Cancel</button>
    </div>
  ),
}))

vi.mock('../components/members/AdjustTabModal', () => ({
  default: ({ member, onClose, onAdjusted }) => (
    <div role="dialog" aria-label="adjust-tab">
      <span>Adjust {member.name}</span>
      <button onClick={() => onAdjusted(-5)}>Confirm Adjust</button>
      <button onClick={onClose}>Cancel Adjust</button>
    </div>
  ),
}))

import { fetchOpenTabs, fetchTabOrders, removeOrderFromTab } from '../lib/tabs'
import { printTabsList, printTabStatement, getPrinterIp } from '../lib/starPrinter'
import { logEvent } from '../lib/audit/log'

const eventsOfType = type => logEvent.mock.calls.filter(c => c[0] === type)

const mockTabs = [
  { id: 'm1', name: 'Alice', tab_balance: 15.50, membership_number: 'M0001' },
  { id: 'm2', name: 'Bob', tab_balance: 8.00, membership_number: 'M0002' },
]

const mockOrders = [
  {
    id: 'o1',
    created_at: '2026-03-30T20:00:00Z',
    total_amount: 15.50,
    order_items: [
      { id: 'oi1', quantity: 2, unit_price: 5.50, products: { name: 'Guinness' } },
      { id: 'oi2', quantity: 1, unit_price: 4.50, products: { name: 'Coke' } },
    ],
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  fetchOpenTabs.mockResolvedValue(mockTabs)
  fetchTabOrders.mockResolvedValue(mockOrders)
  printTabsList.mockResolvedValue(undefined)
  printTabStatement.mockResolvedValue(undefined)
  getPrinterIp.mockReturnValue('192.168.1.100')
  removeOrderFromTab.mockResolvedValue(undefined)
})

describe('TabsPage', () => {
  it('renders the page heading', async () => {
    render(<TabsPage />)
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /tabs/i })).toBeInTheDocument()
    })
  })

  it('shows loading state initially', () => {
    fetchOpenTabs.mockReturnValue(new Promise(() => {}))
    render(<TabsPage />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('lists all members with open tabs', async () => {
    render(<TabsPage />)
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument()
      expect(screen.getByText('Bob')).toBeInTheDocument()
    })
  })

  it('shows outstanding balance for each member', async () => {
    render(<TabsPage />)
    await waitFor(() => {
      expect(screen.getByText('£15.50')).toBeInTheDocument()
      expect(screen.getByText('£8.00')).toBeInTheDocument()
    })
  })

  it('shows total outstanding balance', async () => {
    render(<TabsPage />)
    await waitFor(() => {
      expect(screen.getByText('£23.50')).toBeInTheDocument()
    })
  })

  it('shows empty state when no open tabs', async () => {
    fetchOpenTabs.mockResolvedValue([])
    render(<TabsPage />)
    await waitFor(() => {
      expect(screen.getByText(/no open tabs/i)).toBeInTheDocument()
    })
  })

  it('expands a row to show orders when clicked', async () => {
    render(<TabsPage />)
    await waitFor(() => screen.getByText('Alice'))
    fireEvent.click(screen.getByText('Alice'))
    await waitFor(() => {
      expect(fetchTabOrders).toHaveBeenCalledWith('m1')
      expect(screen.getByText('Guinness')).toBeInTheDocument()
      expect(screen.getByText('Coke')).toBeInTheDocument()
    })
  })

  it('shows a Settle button for each member', async () => {
    render(<TabsPage />)
    await waitFor(() => {
      const settleButtons = screen.getAllByRole('button', { name: /settle/i })
      expect(settleButtons).toHaveLength(2)
    })
  })

  it('opens SettleTabModal when Settle is clicked', async () => {
    render(<TabsPage />)
    await waitFor(() => screen.getAllByRole('button', { name: /settle/i }))
    fireEvent.click(screen.getAllByRole('button', { name: /settle/i })[0])
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Settle Alice')).toBeInTheDocument()
  })

  it('removes member from list after a FULL settle', async () => {
    render(<TabsPage />)
    await waitFor(() => screen.getAllByRole('button', { name: /settle/i }))
    fireEvent.click(screen.getAllByRole('button', { name: /settle/i })[0])
    fireEvent.click(screen.getByText('Confirm Settle Full'))
    await waitFor(() => {
      expect(screen.queryByText('Alice')).not.toBeInTheDocument()
      expect(screen.getByText('Bob')).toBeInTheDocument()
    })
  })

  it('keeps member listed with reduced balance after a PARTIAL settle', async () => {
    render(<TabsPage />)
    await waitFor(() => screen.getAllByRole('button', { name: /settle/i }))
    // Alice has 15.50; the stub's partial button settles 5.00
    fireEvent.click(screen.getAllByRole('button', { name: /settle/i })[0])
    fireEvent.click(screen.getByText('Confirm Settle Partial'))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.getByText('Alice')).toBeInTheDocument()
      expect(screen.getByText(/10\.50/)).toBeInTheDocument()
    })
  })

  it('closes modal without removing member when Cancel is clicked', async () => {
    render(<TabsPage />)
    await waitFor(() => screen.getAllByRole('button', { name: /settle/i }))
    fireEvent.click(screen.getAllByRole('button', { name: /settle/i })[0])
    fireEvent.click(screen.getByText('Cancel'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
  })

  it('shows an error message when fetchOpenTabs rejects', async () => {
    fetchOpenTabs.mockRejectedValue(new Error('Network error'))
    render(<TabsPage />)
    await waitFor(() => {
      expect(screen.getByText(/failed to load tabs/i)).toBeInTheDocument()
      expect(screen.queryByText(/no open tabs/i)).not.toBeInTheDocument()
    })
  })

  it('shows an error message when fetchTabOrders rejects inside an expanded row', async () => {
    fetchTabOrders.mockRejectedValue(new Error('Network error'))
    render(<TabsPage />)
    await waitFor(() => screen.getByText('Alice'))
    fireEvent.click(screen.getByText('Alice'))
    await waitFor(() => {
      expect(screen.getByText(/failed to load orders/i)).toBeInTheDocument()
      expect(screen.queryByText(/no tab orders found/i)).not.toBeInTheDocument()
    })
  })

  it('shows an Adjust button in expanded row', async () => {
    render(<TabsPage />)
    await waitFor(() => screen.getByText('Alice'))
    fireEvent.click(screen.getByText('Alice'))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /adjust/i })).toBeInTheDocument()
    })
  })

  it('opens AdjustTabModal when Adjust is clicked', async () => {
    render(<TabsPage />)
    await waitFor(() => screen.getByText('Alice'))
    fireEvent.click(screen.getByText('Alice'))
    await waitFor(() => screen.getByRole('button', { name: /adjust/i }))
    fireEvent.click(screen.getByRole('button', { name: /adjust/i }))
    expect(screen.getByLabelText('adjust-tab')).toBeInTheDocument()
  })

  it('shows a Print button when there are open tabs', async () => {
    render(<TabsPage />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /print tabs/i })).toBeInTheDocument()
    })
  })

  it('does NOT show a Print button when there are no open tabs', async () => {
    fetchOpenTabs.mockResolvedValue([])
    render(<TabsPage />)
    await waitFor(() => screen.getByText(/no open tabs/i))
    expect(screen.queryByRole('button', { name: /print tabs/i })).not.toBeInTheDocument()
  })

  it('prints the current tabs when Print is clicked', async () => {
    render(<TabsPage />)
    await waitFor(() => screen.getByRole('button', { name: /print tabs/i }))
    fireEvent.click(screen.getByRole('button', { name: /print tabs/i }))
    await waitFor(() => {
      expect(printTabsList).toHaveBeenCalledWith(mockTabs)
    })
  })

  it('re-enables the Print button after a failed print', async () => {
    printTabsList.mockRejectedValue(new Error('Bridge returned 502'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<TabsPage />)
    await waitFor(() => screen.getByRole('button', { name: /print tabs/i }))
    fireEvent.click(screen.getByRole('button', { name: /print tabs/i }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /print tabs/i })).not.toBeDisabled()
    })
    vi.restoreAllMocks()
  })

  it('shows a Print statement button in expanded row', async () => {
    render(<TabsPage />)
    await waitFor(() => screen.getByText('Alice'))
    fireEvent.click(screen.getByText('Alice'))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /print tab statement for alice/i })).toBeInTheDocument()
    })
  })

  it('prints an itemised statement with fresh orders when Print is clicked', async () => {
    render(<TabsPage />)
    await waitFor(() => screen.getByText('Alice'))
    fireEvent.click(screen.getByText('Alice'))
    await waitFor(() => screen.getByRole('button', { name: /print tab statement/i }))
    fetchTabOrders.mockClear()
    fireEvent.click(screen.getByRole('button', { name: /print tab statement/i }))
    await waitFor(() => {
      expect(fetchTabOrders).toHaveBeenCalledWith('m1')
      expect(printTabStatement).toHaveBeenCalledWith({ member: mockTabs[0], orders: mockOrders })
    })
  })

  it('re-enables the statement Print button after a failed print', async () => {
    printTabStatement.mockRejectedValue(new Error('Bridge returned 502'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<TabsPage />)
    await waitFor(() => screen.getByText('Alice'))
    fireEvent.click(screen.getByText('Alice'))
    await waitFor(() => screen.getByRole('button', { name: /print tab statement/i }))
    fireEvent.click(screen.getByRole('button', { name: /print tab statement/i }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /print tab statement/i })).not.toBeDisabled()
    })
    vi.restoreAllMocks()
  })

  it('shows a Remove button for each order in expanded row', async () => {
    render(<TabsPage />)
    await waitFor(() => screen.getByText('Alice'))
    fireEvent.click(screen.getByText('Alice'))
    await waitFor(() => screen.getByText('Guinness'))
    expect(screen.getByRole('button', { name: /remove order/i })).toBeInTheDocument()
  })
})

describe('TabsPage — audit events', () => {
  async function expandAlice() {
    render(<TabsPage />)
    await waitFor(() => screen.getByText('Alice'))
    fireEvent.click(screen.getByText('Alice'))
    await waitFor(() => screen.getByText('Guinness'))
  }

  it('logs nothing just for listing the open tabs', async () => {
    render(<TabsPage />)
    await waitFor(() => screen.getByText('Alice'))
    expect(logEvent).not.toHaveBeenCalled()
  })

  it('logs whose drinks were opened up', async () => {
    await expandAlice()
    expect(logEvent.mock.calls).toEqual([
      ['tab.orders_viewed', { member_id: 'm1', member_name: 'Alice' }],
    ])
  })

  it('logs nothing when the drinks fail to load', async () => {
    fetchTabOrders.mockRejectedValue(new Error('Network error'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<TabsPage />)
    await waitFor(() => screen.getByText('Alice'))
    fireEvent.click(screen.getByText('Alice'))
    await waitFor(() => screen.getByText(/failed to load orders/i))
    expect(logEvent).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })

  it('logs tab.order_removed once the order is off the tab', async () => {
    await expandAlice()
    logEvent.mockClear()
    let finish
    removeOrderFromTab.mockReturnValue(new Promise(resolve => { finish = resolve }))
    fireEvent.click(screen.getByRole('button', { name: /remove order/i }))
    await waitFor(() => expect(removeOrderFromTab).toHaveBeenCalledWith('o1', 'm1', 15.50))
    // not on the tap — only once it has actually been removed
    expect(logEvent).not.toHaveBeenCalled()
    finish()
    await waitFor(() => expect(screen.queryByText('Alice')).not.toBeInTheDocument())
    expect(logEvent.mock.calls).toEqual([
      ['tab.order_removed', { order_id: 'o1', member_id: 'm1', member_name: 'Alice', value: 15.5 }, { severity: 1 }],
    ])
  })

  it('logs nothing when removing the order fails', async () => {
    await expandAlice()
    logEvent.mockClear()
    removeOrderFromTab.mockRejectedValue(new Error('Tab already settled'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    fireEvent.click(screen.getByRole('button', { name: /remove order/i }))
    await waitFor(() => expect(fetchOpenTabs).toHaveBeenCalledTimes(2))
    await waitFor(() => screen.getByText('Alice'))
    expect(eventsOfType('tab.order_removed')).toEqual([])
    vi.restoreAllMocks()
  })

  it('logs tab.summary_printed with how many tabs and their total', async () => {
    render(<TabsPage />)
    await waitFor(() => screen.getByRole('button', { name: /print tabs/i }))
    fireEvent.click(screen.getByRole('button', { name: /print tabs/i }))
    await waitFor(() => expect(logEvent).toHaveBeenCalled())
    expect(logEvent.mock.calls).toEqual([
      ['tab.summary_printed', { tabs: 2, total: 23.5 }],
    ])
  })

  it('logs the failure, not a print, when the tab list does not print', async () => {
    printTabsList.mockRejectedValue(new Error('Bridge returned 502'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<TabsPage />)
    await waitFor(() => screen.getByRole('button', { name: /print tabs/i }))
    fireEvent.click(screen.getByRole('button', { name: /print tabs/i }))
    await waitFor(() => expect(logEvent).toHaveBeenCalled())
    expect(logEvent.mock.calls).toEqual([
      ['receipt.print_failed', { what: 'tab_summary', message: 'Bridge returned 502' }, { severity: 1 }],
    ])
    vi.restoreAllMocks()
  })

  it('logs no print when no printer is configured (nothing came out)', async () => {
    getPrinterIp.mockReturnValue(null)
    render(<TabsPage />)
    await waitFor(() => screen.getByRole('button', { name: /print tabs/i }))
    fireEvent.click(screen.getByRole('button', { name: /print tabs/i }))
    await waitFor(() => expect(printTabsList).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByRole('button', { name: /print tabs/i })).not.toBeDisabled())
    expect(logEvent).not.toHaveBeenCalled()
  })

  it('logs tab.statement_printed for the member whose statement was printed', async () => {
    await expandAlice()
    logEvent.mockClear()
    fireEvent.click(screen.getByRole('button', { name: /print tab statement/i }))
    await waitFor(() => expect(logEvent).toHaveBeenCalled())
    expect(logEvent.mock.calls).toEqual([
      ['tab.statement_printed', { member_id: 'm1', member_name: 'Alice' }],
    ])
  })

  it('logs the failure when a statement does not print', async () => {
    await expandAlice()
    logEvent.mockClear()
    printTabStatement.mockRejectedValue(new Error('Bridge returned 502'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    fireEvent.click(screen.getByRole('button', { name: /print tab statement/i }))
    await waitFor(() => expect(logEvent).toHaveBeenCalled())
    expect(logEvent.mock.calls).toEqual([
      ['receipt.print_failed', { what: 'tab_statement', message: 'Bridge returned 502', member_id: 'm1' }, { severity: 1 }],
    ])
    vi.restoreAllMocks()
  })

  it('logs a tap on a member\'s blurred balance, and still reveals it', async () => {
    render(<TabsPage />)
    await waitFor(() => screen.getByText('Bob'))
    // [0] is the total outstanding, then one per member row
    const amounts = screen.getAllByRole('button', { name: /tap to reveal tab amount/i })
    fireEvent.click(amounts[2])
    expect(screen.getByRole('button', { name: /tab amount visible/i })).toHaveTextContent('£8.00')
    expect(logEvent.mock.calls).toEqual([
      ['tab.amount_revealed', { member_id: 'm2' }],
    ])
  })

  it('logs a tap on the total outstanding', async () => {
    render(<TabsPage />)
    await waitFor(() => screen.getByText('Bob'))
    fireEvent.click(screen.getAllByRole('button', { name: /tap to reveal tab amount/i })[0])
    expect(logEvent.mock.calls).toEqual([
      ['tab.amount_revealed', { member_id: null, what: 'total_outstanding' }],
    ])
  })
})
