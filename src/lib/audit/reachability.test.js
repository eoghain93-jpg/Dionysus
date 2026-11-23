import { describe, it, expect, beforeEach } from 'vitest'
import { markReached, markUnreachable, serverUnreachable, answersSeen } from './reachability'

beforeEach(() => markReached()) // module state: start every test "reachable"

describe('reachability', () => {
  it('assumes the server can be reached until something says otherwise', () => {
    expect(serverUnreachable()).toBe(false)
  })

  it('remembers a failed attempt until the server next answers', () => {
    markUnreachable()
    expect(serverUnreachable()).toBe(true)
    expect(serverUnreachable()).toBe(true) // reading it does not clear it

    markReached()
    expect(serverUnreachable()).toBe(false)
  })

  it('one answer is enough, however many attempts failed', () => {
    markUnreachable()
    markUnreachable()
    markReached()
    expect(serverUnreachable()).toBe(false)
  })

  it('counts answers, so a caller can tell whether the server answered during an attempt', () => {
    const before = answersSeen()
    markUnreachable()
    expect(answersSeen()).toBe(before) // a failure is not an answer

    markReached()
    markReached()
    expect(answersSeen()).toBe(before + 2)
  })
})
