import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import AuditEntry from './AuditEntry'

const SAM = '5a000000-0000-0000-0000-000000000001'
const MO = 'a0000000-0000-0000-0000-000000000003'
const GUINNESS = 'b0000000-0000-0000-0000-000000000001'
const CRISPS = 'b0000000-0000-0000-0000-000000000002'
const ORDER = 'c0000000-0000-0000-0000-000000000002'
const names = { [SAM]: 'Sam Staff', [MO]: 'Mo Member', [GUINNESS]: 'Guinness', [CRISPS]: 'Crisps' }
const at = (hour, minute = 0) => new Date(2026, 10, 22, hour, minute, 0).toISOString()

const base = {
  seq: 200, at: at(14, 2), severity: 0, table: null, pk: null, subject: null, old: null, new: null, changed: null, detail: null,
  actor: 'till', till_id: 'till-1', staff_id: SAM, staff_name: 'Sam Staff', staff_trust: 'pin',
  via: 'PATCH /products', ip: '203.0.113.10', app_build: 'test123', client_at: null, sealed: true, checked: false,
}

const show = (entry, props = {}) => render(<ul><AuditEntry entry={entry} ctx={{ names }} {...props} /></ul>)
const openDetail = () => fireEvent.click(screen.getByRole('button', { name: 'Full detail' }))

describe('AuditEntry', () => {
  it('labels how sure the log is about who it was', () => {
    const entry = { ...base, kind: 'event', action: 'report.exported', via: 'POST /rpc/audit_log_events', detail: { report: 'daily', date: '2026-11-22', rows: 12, till: 'till-1', page: '/reports' } }
    const { rerender } = show({ ...entry, staff_trust: 'claimed' })
    expect(screen.getByText('said to be')).toBeInTheDocument()

    rerender(<ul><AuditEntry entry={{ ...entry, staff_trust: 'session_record' }} ctx={{ names }} /></ul>)
    expect(screen.getByText('matched a sign-in')).toBeInTheDocument()

    rerender(<ul><AuditEntry entry={{ ...entry, staff_id: null, staff_name: null, staff_trust: 'none' }} ctx={{ names }} /></ul>)
    expect(screen.getByText('Nobody signed in')).toBeInTheDocument()
    expect(screen.queryByText('PIN checked')).not.toBeInTheDocument()
  })

  it('a routine entry is quiet: no severity label, no "Mark as checked"', () => {
    show({ ...base, kind: 'event', action: 'page.viewed', via: 'POST /rpc/audit_log_events', detail: { path: '/stock', till: 'till-1', page: '/stock' } }, { onAck: vi.fn() })
    expect(screen.getByText('Opened the Stock page')).toBeInTheDocument()
    expect(screen.queryByText('Notable')).not.toBeInTheDocument()
    expect(screen.queryByText('Needs a look')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mark as checked' })).not.toBeInTheDocument()
  })

  it('pressing Enter in the note marks the alert as checked with that note', async () => {
    const onAck = vi.fn().mockResolvedValue()
    const entry = { ...base, kind: 'event', action: 'drawer.opened_no_sale', severity: 2, via: 'POST /rpc/audit_log_events', detail: { source: 'settings', till: 'till-1', page: '/settings' } }
    show(entry, { onAck })

    fireEvent.click(screen.getByRole('button', { name: 'Add a note first' }))
    const note = screen.getByLabelText('Note for this alert')
    fireEvent.change(note, { target: { value: 'float check' } })
    fireEvent.keyDown(note, { key: 'Enter' })

    await waitFor(() => expect(onAck).toHaveBeenCalledWith(entry, 'float check'))
    expect(onAck).toHaveBeenCalledTimes(1)
  })

  it('shows what a blocked edit tried to change', () => {
    show({
      ...base, kind: 'guard', action: 'blocked.update', table: 'order_items', pk: 'l1', severity: 3, via: 'PATCH /order_items',
      old: { id: 'l1', order_id: ORDER, product_id: GUINNESS, quantity: 1, unit_price: 7.4 },
      new: { id: 'l1', order_id: ORDER, product_id: GUINNESS, quantity: 1, unit_price: 0.01 },
      detail: { rule: 'immutable', flags: ['history_rewrite_attempt'] },
    })
    expect(screen.getByText('Serious')).toBeInTheDocument()
    expect(screen.getByText('Attempt to change past records')).toBeInTheDocument()
    openDetail()
    expect(screen.getByText('The record')).toBeInTheDocument()
    const attempted = screen.getByText('What they tried to change it to').parentElement
    expect(attempted).toHaveTextContent('price each:£0.01')
    expect(attempted).not.toHaveTextContent('quantity')
    expect(screen.getByText('Straight to the sale lines list (editing)')).toBeInTheDocument()
  })

  it('shows each line of a sale with the product’s name and list prices', () => {
    const onOpenRecord = vi.fn()
    show({
      ...base, kind: 'row', action: 'insert', table: 'order_items', pk: ORDER, via: 'POST /rpc/create_order_with_items',
      new: [
        { id: 'l1', product_id: GUINNESS, quantity: 2, unit_price: 6.4, member_price_applied: true, staff_credit_for: null },
        { id: 'l2', product_id: CRISPS, quantity: 1, unit_price: 0.5, member_price_applied: false, staff_credit_for: null },
      ],
      detail: {
        lines: { l1: { product: 'Guinness', list_standard: 7.4, list_member: 6.4 }, l2: { product: 'Crisps', list_standard: 1, list_member: 1, below_list_price: true } },
        rows: 2, flags: ['below_list_price'],
      },
    }, { onOpenRecord })
    openDetail()
    const added = screen.getByText('What was added (2)').parentElement
    expect(added).toHaveTextContent('product:Guinness')
    expect(added).toHaveTextContent('price each:£6.40')
    expect(added).toHaveTextContent('list price:£7.40')
    expect(added).toHaveTextContent('members’ list price:£6.40')
    expect(added).toHaveTextContent('product:Crisps')
    expect(added).toHaveTextContent('below list price:yes')
    expect(screen.getByText('Through the app’s routine “create_order_with_items”')).toBeInTheDocument()
    // the lines belong to a sale, so the sale is the record on offer
    fireEvent.click(screen.getByRole('button', { name: 'Everything recorded about this sale' }))
    expect(onOpenRecord).toHaveBeenCalledWith('orders', ORDER)
  })

  it('offers no record history without somewhere to open it, or for the log’s own housekeeping', () => {
    const { unmount } = show({ ...base, kind: 'row', action: 'update', table: 'products', pk: GUINNESS, subject: 'Guinness', changed: ['active'], old: { active: true }, new: { active: false } })
    openDetail()
    expect(screen.queryByRole('button', { name: /Everything recorded about/ })).not.toBeInTheDocument()
    unmount()

    show({ ...base, kind: 'system', action: 'alert.checked', pk: '57', detail: { note: 'looked into it' } }, { onOpenRecord: vi.fn() })
    openDetail()
    expect(screen.queryByRole('button', { name: /Everything recorded about/ })).not.toBeInTheDocument()
  })

  it('shows what was deleted, and the till’s own clock for a till report', () => {
    const onOpenRecord = vi.fn()
    const { unmount } = show({
      ...base, kind: 'row', action: 'delete', table: 'orders', pk: ORDER, severity: 2, actor: 'service', till_id: null,
      staff_id: null, staff_name: null, staff_trust: 'none', via: 'DELETE /orders',
      old: { id: ORDER, member_id: MO, payment_method: 'card', total_amount: 1, status: 'paid', created_at: at(12, 0) },
    }, { onOpenRecord })
    expect(screen.getByText('The system')).toBeInTheDocument()
    expect(screen.getByText('not a person at a till')).toBeInTheDocument()
    openDetail()
    const deleted = screen.getByText('What was deleted').parentElement
    expect(deleted).toHaveTextContent('member:Mo Member')
    expect(deleted).toHaveTextContent('total:£1.00')
    expect(screen.getByText('The system itself (a server function, not a till)')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Everything recorded about this sale' }))
    expect(onOpenRecord).toHaveBeenCalledWith('orders', ORDER)
    unmount()

    show({
      ...base, kind: 'event', action: 'cart.line_removed', severity: 1, via: 'POST /rpc/audit_log_events', client_at: at(14, 1),
      detail: { product: 'Guinness', quantity: 2, unit_price: 7.4, value: 14.8, till: 'till-1', page: '/' },
    })
    expect(screen.getByText('Notable')).toBeInTheDocument()
    expect(screen.getByText(/reported by the till/)).toBeInTheDocument()
    openDetail()
    expect(screen.getByText('Till’s own clock said:')).toBeInTheDocument()
    expect(screen.getByText('More detail').parentElement).toHaveTextContent('value:£14.80')
  })
})
