import { describe, it, expect } from 'vitest'
import { healthFacts, healthIssues, timeAgo, whenText } from './health'

const NOW = new Date(2026, 10, 22, 14, 0, 0).getTime()
const ago = minutes => new Date(NOW - minutes * 60 * 1000).toISOString()

const healthy = (extra = {}) => ({
  entries: 12340,
  entries_24h: 310,
  last_entry_at: ago(2),
  unsealed: 3,
  oldest_unsealed_at: ago(2),
  seal: { id: 42, code: 'S42-4F2A-91BC', hash: 'aa'.repeat(32), sealed_at: ago(3) },
  last_check: { result: 'integrity.ok', at: ago(9 * 60) },
  unchecked_alerts: 0,
  capture_failures_7d: 0,
  coverage: { tables: 22, missing: [], disabled: [] },
  settings: { capture_enabled: true, guards_enforced: true, session_max_hours: 24 },
  bytes: 4.2 * 1024 * 1024,
  ...extra,
})

const texts = issues => issues.map(i => i.text)

describe('timeAgo and whenText', () => {
  it('words how long ago something was', () => {
    expect(timeAgo(ago(0.5), NOW)).toBe('just now')
    expect(timeAgo(ago(5), NOW)).toBe('5 minutes ago')
    expect(timeAgo(ago(180), NOW)).toBe('3 hours ago')
    expect(timeAgo(ago(3 * 24 * 60), NOW)).toBe('3 days ago')
    expect(timeAgo(null, NOW)).toBe('')
  })

  it('gives the clock time, with the day when it was not today', () => {
    expect(whenText(ago(5), NOW)).toBe('13:55 (5 minutes ago)')
    expect(whenText(ago(26 * 60), NOW)).toMatch(/^Sat 21 Nov, 12:00 \(26 hours ago\)$/)
    expect(whenText(null, NOW)).toBe('never')
  })
})

describe('healthIssues', () => {
  it('is silent when everything is fine', () => {
    expect(healthIssues(healthy(), { now: NOW })).toEqual([])
    expect(healthIssues(null, { now: NOW })).toEqual([])
  })

  it('shouts when recording is switched off', () => {
    const issues = healthIssues(healthy({ settings: { capture_enabled: false, guards_enforced: true } }), { now: NOW })
    expect(issues).toEqual([{ level: 'bad', text: 'Recording is switched OFF. Changes to the books are not being logged.' }])
  })

  it('shouts when the last check failed', () => {
    const issues = healthIssues(healthy({ last_check: { result: 'integrity.FAILED', at: ago(60) } }), { now: NOW })
    expect(issues).toHaveLength(1)
    expect(issues[0].level).toBe('bad')
    expect(issues[0].text).toMatch(/^The last check FAILED: 13:00 \(60 minutes ago\)\. /)
  })

  it('shouts when something is not covered or has been switched off, in words', () => {
    const issues = healthIssues(healthy({ coverage: { tables: 22, missing: ['order_items:insert'], disabled: ['orders', 'auditlog.log:append_only'] } }), { now: NOW })
    expect(issues).toEqual([
      { level: 'bad', text: 'Not being recorded: new sale lines.' },
      { level: 'bad', text: 'Recording has been switched off for: sales, the lock on the log itself.' },
    ])
  })

  it('shouts when this till remembers a seal the database has changed or lost', () => {
    const different = healthIssues(healthy(), { now: NOW, remembered: { id: 42, code: 'S42-0000-1111', hash: 'bb'.repeat(32) } })
    expect(different).toHaveLength(1)
    expect(different[0].level).toBe('bad')
    expect(different[0].text).toContain('S42-0000-1111')
    expect(different[0].text).toContain('S42-4F2A-91BC')

    const behind = healthIssues(healthy(), { now: NOW, remembered: { id: 50, code: 'S50-AAAA-BBBB', hash: 'cc'.repeat(32) } })
    expect(behind[0].level).toBe('bad')
    expect(behind[0].text).toMatch(/newer seal \(S50-AAAA-BBBB\)/)

    const gone = healthIssues(healthy({ seal: null, unsealed: 0, oldest_unsealed_at: null }), { now: NOW, remembered: { id: 5, code: 'S5-AAAA-BBBB', hash: 'dd' } })
    expect(gone[0].text).toMatch(/no seals at all/)
  })

  it('stays quiet when this till’s remembered seal matches, or is simply older', () => {
    const same = { id: 42, code: 'S42-4F2A-91BC', hash: 'aa'.repeat(32) }
    const older = { id: 40, code: 'S40-1111-2222', hash: 'ee'.repeat(32) }
    expect(healthIssues(healthy(), { now: NOW, remembered: same })).toEqual([])
    expect(healthIssues(healthy(), { now: NOW, remembered: older })).toEqual([])
    expect(healthIssues(healthy(), { now: NOW, remembered: null })).toEqual([])
  })

  it('warns about capture failures and watch-only protection', () => {
    const issues = healthIssues(healthy({ capture_failures_7d: 3, settings: { capture_enabled: true, guards_enforced: false } }), { now: NOW })
    expect(issues.map(i => i.level)).toEqual(['warn', 'warn'])
    expect(issues[0].text).toBe('3 changes could not be recorded in the last 7 days.')
    expect(issues[1].text).toMatch(/watch-only mode/)
    expect(texts(healthIssues(healthy({ capture_failures_7d: 1 }), { now: NOW }))).toEqual(['1 change could not be recorded in the last 7 days.'])
  })

  it('warns when sealing has fallen behind, but not for entries from the last few minutes', () => {
    const behind = healthIssues(healthy({ unsealed: 120, oldest_unsealed_at: ago(90) }), { now: NOW })
    expect(behind).toHaveLength(1)
    expect(behind[0].level).toBe('warn')
    expect(behind[0].text).toMatch(/^Sealing is behind: 120 entries have been waiting for a seal since 12:30/)
    expect(healthIssues(healthy({ unsealed: 5, oldest_unsealed_at: ago(4) }), { now: NOW })).toEqual([])
  })

  it('warns when the nightly check has stopped running', () => {
    const issues = healthIssues(healthy({ last_check: { result: 'integrity.ok', at: ago(50 * 60) } }), { now: NOW })
    expect(issues).toHaveLength(1)
    expect(issues[0].text).toMatch(/^The nightly check has not run since /)
    // A fresh install has simply not had its first night yet.
    expect(healthIssues(healthy({ last_check: null }), { now: NOW })).toEqual([])
  })

  it('never uses database jargon', () => {
    const everythingWrong = healthy({
      settings: { capture_enabled: false, guards_enforced: false },
      last_check: { result: 'integrity.FAILED', at: ago(60) },
      coverage: { missing: ['order_items:insert', 'tabs'], disabled: ['orders', 'auditlog.seals:append_only'] },
      capture_failures_7d: 9,
      unsealed: 50,
      oldest_unsealed_at: ago(600),
    })
    const all = [
      ...texts(healthIssues(everythingWrong, { now: NOW, remembered: { id: 99, code: 'S99-AAAA-BBBB', hash: 'ff' } })),
      ...healthFacts(everythingWrong, { now: NOW }).flatMap(f => [f.label, f.value]),
    ]
    expect(all.length).toBeGreaterThan(8)
    for (const text of all) expect(text).not.toMatch(/\b(rows?|rpc|triggers?|hash(es)?|null|undefined|NaN)\b/i)
  })
})

describe('healthFacts', () => {
  it('lists the quiet facts', () => {
    expect(healthFacts(healthy(), { now: NOW })).toEqual([
      { label: 'Recording', value: 'on' },
      { label: 'Last entry', value: '13:58 (2 minutes ago)' },
      { label: 'Newest seal', value: 'S42-4F2A-91BC · 13:57 (3 minutes ago)' },
      { label: 'Last check', value: 'passed · 05:00 (9 hours ago)' },
      { label: 'Size', value: '4.2 MB · 12,340 entries (310 in the last 24 hours)' },
    ])
  })

  it('copes with a brand new, empty log', () => {
    const facts = healthFacts({ entries: 0, entries_24h: 0, last_entry_at: null, seal: null, last_check: null, bytes: 8192, settings: {} }, { now: NOW })
    expect(facts.map(f => f.value)).toEqual(['on', 'none yet', 'none yet', 'not run yet', '8 KB · 0 entries (0 in the last 24 hours)'])
    expect(healthFacts(null, { now: NOW })).toEqual([])
  })

  it('says FAILED and OFF in capitals', () => {
    const facts = healthFacts(healthy({ settings: { capture_enabled: false }, last_check: { result: 'integrity.FAILED', at: ago(60) } }), { now: NOW })
    expect(facts[0].value).toBe('OFF')
    expect(facts[3].value).toMatch(/^FAILED · /)
  })
})
