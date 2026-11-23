import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import AuditEntry from './AuditEntry'

const SAM = '5a000000-0000-0000-0000-000000000001'
const KIM = '5a000000-0000-0000-0000-000000000002'
const MO = 'a0000000-0000-0000-0000-000000000003'
const GUINNESS = 'b0000000-0000-0000-0000-000000000001'
const CRISPS = 'b0000000-0000-0000-0000-000000000002'
const ORDER = 'c0000000-0000-0000-0000-000000000002'
const names = { [SAM]: 'Sam Staff', [KIM]: 'Kim Newstarter', [MO]: 'Mo Member', [GUINNESS]: 'Guinness', [CRISPS]: 'Crisps' }
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

  it('a refused write to a member’s PIN reads as refused, and never shows a PIN', () => {
    const onOpenRecord = vi.fn()
    show({
      ...base, kind: 'guard', action: 'blocked.update', table: 'members', pk: KIM, subject: 'Kim Newstarter', severity: 3, via: 'POST /rpc/graphql',
      changed: ['pin_hash', 'tab_balance'], old: { pin_hash: '[redacted]', tab_balance: 12 }, new: { pin_hash: '[redacted]', tab_balance: 0 },
      detail: { rule: 'protected_fields', flags: ['direct_edit_of_protected_field'] },
    }, { onOpenRecord })
    expect(screen.getByText('Tried to change Kim Newstarter’s PIN and tab balance directly — refused')).toBeInTheDocument()
    expect(screen.getByText('Serious')).toBeInTheDocument()
    expect(screen.getByText('Direct edit of a protected figure refused')).toBeInTheDocument()
    expect(screen.getByText('It came through the database’s GraphQL door, which the till app does not use.')).toBeInTheDocument()

    openDetail()
    const was = screen.getByText('As it was').parentElement
    expect(was).toHaveTextContent('PIN:PIN set (hidden)')
    expect(was).toHaveTextContent('tab balance:£12.00')
    const tried = screen.getByText('What they tried to change it to').parentElement
    expect(tried).toHaveTextContent('PIN:a different PIN (hidden)')
    expect(tried).toHaveTextContent('tab balance:£0.00')
    expect(screen.getByText('Through the database’s GraphQL door, not the till app')).toBeInTheDocument()
    expect(screen.getByText('More detail').parentElement).toHaveTextContent('rule:only the app’s own PIN-checked steps may change these')
    expect(document.body.textContent).not.toMatch(/redacted|graphql\b|protected_fields/)
    fireEvent.click(screen.getByRole('button', { name: 'Everything recorded about this member' }))
    expect(onOpenRecord).toHaveBeenCalledWith('members', KIM)
  })

  it('shows what a protected field was cleared to, and what went through in watch-only mode', () => {
    show({
      ...base, kind: 'guard', action: 'would_block.update', table: 'members', pk: MO, subject: 'Mo Member', severity: 3, via: 'PATCH /members',
      changed: ['auth_user_id', 'pin_hash'], old: { auth_user_id: KIM, pin_hash: '[redacted]' }, new: { auth_user_id: null, pin_hash: null },
      detail: { rule: 'protected_fields', flags: ['direct_edit_of_protected_field'] },
    })
    expect(screen.getByText('Allowed, but should not happen: Mo Member’s app login and PIN were changed directly')).toBeInTheDocument()
    openDetail()
    const changedTo = screen.getByText('What it was changed to').parentElement
    expect(changedTo).toHaveTextContent('app login:—')
    expect(changedTo).toHaveTextContent('PIN:no PIN')
    expect(screen.queryByText('What they tried to change it to')).not.toBeInTheDocument()
  })

  it('a change to a sale’s line, or a refused attempt on one, opens the sale it belongs to', () => {
    const onOpenRecord = vi.fn()
    // filed under the sale's id, like the lines themselves
    const { unmount } = show({
      ...base, kind: 'guard', action: 'blocked.update', table: 'order_items', pk: ORDER, severity: 3, via: 'PATCH /order_items',
      old: { id: 'l1', order_id: ORDER, product_id: GUINNESS, quantity: 1, unit_price: 7.4 },
      new: { id: 'l1', order_id: ORDER, product_id: GUINNESS, quantity: 1, unit_price: 0.01 },
      detail: { rule: 'immutable', flags: ['history_rewrite_attempt'] },
    }, { onOpenRecord })
    openDetail()
    fireEvent.click(screen.getByRole('button', { name: 'Everything recorded about this sale' }))
    expect(onOpenRecord).toHaveBeenLastCalledWith('orders', ORDER)
    unmount()

    const update = show({
      ...base, kind: 'row', action: 'update', table: 'order_items', pk: ORDER, severity: 2, actor: 'database', via: 'sql:postgres/psql',
      changed: ['unit_price'], old: { unit_price: 7.4 }, new: { unit_price: 0.01 },
    }, { onOpenRecord })
    openDetail()
    fireEvent.click(screen.getByRole('button', { name: 'Everything recorded about this sale' }))
    expect(onOpenRecord).toHaveBeenLastCalledWith('orders', ORDER)
    update.unmount()

    // an older entry about one line is filed under the line, but still says which sale
    show({
      ...base, kind: 'row', action: 'delete', table: 'order_items', pk: 'l1', severity: 2, actor: 'service', via: 'DELETE /order_items',
      old: { id: 'l1', order_id: ORDER, product_id: GUINNESS, quantity: 1, unit_price: 7.4 },
    }, { onOpenRecord })
    openDetail()
    fireEvent.click(screen.getByRole('button', { name: 'Everything recorded about this sale' }))
    expect(onOpenRecord).toHaveBeenLastCalledWith('orders', ORDER)
  })

  it('shows who checked an alert, when and why — and when they were checking their own', () => {
    const alert = { ...base, kind: 'event', action: 'drawer.opened_no_sale', severity: 2, via: 'POST /rpc/audit_log_events', detail: { source: 'settings' } }
    const { rerender } = show({ ...alert, checked: true, checked_at: at(15, 0), checked_by: 'Kim Newstarter', checked_by_self: false, check_note: 'float check' }, { onAck: vi.fn() })
    expect(screen.getByText('Checked by Kim Newstarter · Sun 22 Nov, 15:00')).toBeInTheDocument()
    expect(screen.getByText('Note left when it was checked: “float check”')).toBeInTheDocument()
    expect(screen.queryByText('Checked by the person it is about')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mark as checked' })).not.toBeInTheDocument()

    rerender(<ul><AuditEntry entry={{ ...alert, checked: true, checked_at: at(15, 0), checked_by: 'Sam Staff', checked_by_self: true, check_note: null }} ctx={{ names }} /></ul>)
    expect(screen.getByText('Checked by Sam Staff · Sun 22 Nov, 15:00')).toBeInTheDocument()
    expect(screen.getByText('Checked by the person it is about')).toBeInTheDocument()
    expect(screen.queryByText(/Note left when it was checked/)).not.toBeInTheDocument()

    // an older database says only that it was checked
    rerender(<ul><AuditEntry entry={{ ...alert, checked: true }} ctx={{ names }} /></ul>)
    expect(screen.getByText('Checked')).toBeInTheDocument()

    // not checked yet: nothing about a check at all
    rerender(<ul><AuditEntry entry={alert} ctx={{ names }} onAck={vi.fn()} /></ul>)
    expect(screen.queryByText(/^Checked/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mark as checked' })).toBeInTheDocument()
  })

  it('a sale is headed by who rang it, with who sent it in the detail', () => {
    show({
      ...base, kind: 'row', action: 'insert', table: 'orders', pk: ORDER, severity: 2, via: 'POST /rpc/create_order_with_items',
      staff_id: KIM, staff_name: 'Kim Newstarter', staff_trust: 'claimed',
      new: { id: ORDER, staff_id: KIM, payment_method: 'cash', total_amount: 7.4, status: 'paid', till_id: 'till-1', created_at: at(14, 2) },
      detail: { rung_by_trust: 'claimed', sent_by: SAM, sent_by_trust: 'pin', flags: ['staff_mismatch'] },
    })
    expect(screen.getByText('Kim Newstarter')).toBeInTheDocument()
    expect(screen.getByText('said to be')).toBeInTheDocument()
    expect(screen.getByText('Sam Staff was the person signed in (PIN checked), but the till put Kim Newstarter on the sale as who rang it')).toBeInTheDocument()
    expect(screen.getByText('Sale names someone other than the person signed in')).toBeInTheDocument()
    openDetail()
    const more = screen.getByText('More detail').parentElement
    expect(more).toHaveTextContent('signed in when it was sent:Sam Staff')
    expect(more).toHaveTextContent('how sure the log is of them:PIN checked')
  })

  it('shows carrying on past a locked-out PIN as serious', () => {
    show({ ...base, kind: 'event', action: 'till.unlocked_unverified', severity: 2, staff_trust: 'claimed', via: 'POST /rpc/audit_log_events', detail: { reason: 'pin_locked' } }, { onAck: vi.fn() })
    expect(screen.getByText('Till unlocked WITHOUT a PIN check, after five wrong PINs had locked that PIN')).toBeInTheDocument()
    expect(screen.getByText('Serious')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mark as checked' })).toBeInTheDocument()
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
