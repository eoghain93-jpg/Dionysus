import { act } from 'react'
import { useToastStore } from './useToast'

beforeEach(() => {
  useToastStore.setState({ toasts: [] })
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useToastStore', () => {
  it('starts with an empty toasts array', () => {
    expect(useToastStore.getState().toasts).toEqual([])
  })

  it('addToast adds a toast with message and type', () => {
    useToastStore.getState().addToast('Print failed', 'error')
    const toasts = useToastStore.getState().toasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0]).toMatchObject({ message: 'Print failed', type: 'error' })
  })

  it('addToast assigns a unique numeric id', () => {
    useToastStore.getState().addToast('First', 'error')
    useToastStore.getState().addToast('Second', 'success')
    const toasts = useToastStore.getState().toasts
    expect(toasts[0].id).toBeDefined()
    expect(toasts[0].id).not.toBe(toasts[1].id)
  })

  it('toast is auto-removed after 4 seconds', () => {
    useToastStore.getState().addToast('Test', 'error')
    expect(useToastStore.getState().toasts).toHaveLength(1)
    act(() => vi.advanceTimersByTime(4000))
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('toast is NOT removed before 4 seconds', () => {
    useToastStore.getState().addToast('Test', 'error')
    act(() => vi.advanceTimersByTime(3999))
    expect(useToastStore.getState().toasts).toHaveLength(1)
  })

  it('removeToast removes a toast by id', () => {
    useToastStore.getState().addToast('Test', 'error')
    const { id } = useToastStore.getState().toasts[0]
    useToastStore.getState().removeToast(id)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('removeToast does not remove other toasts', () => {
    useToastStore.getState().addToast('First', 'error')
    useToastStore.getState().addToast('Second', 'error')
    const firstId = useToastStore.getState().toasts[0].id
    useToastStore.getState().removeToast(firstId)
    expect(useToastStore.getState().toasts).toHaveLength(1)
    expect(useToastStore.getState().toasts[0].message).toBe('Second')
  })
})
