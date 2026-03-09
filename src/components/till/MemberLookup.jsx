import { useState, useEffect, useRef } from 'react'
import { Search, ScanLine } from 'lucide-react'
import { findMemberByNumber } from '../../lib/members'
import { useTillStore } from '../../stores/tillStore'

export default function MemberLookup() {
  const [query, setQuery] = useState('')
  const [error, setError] = useState(null)
  const { activeMember, setActiveMember } = useTillStore()
  const inputRef = useRef(null)

  // Barcode scanner: USB HID sends characters then Enter key
  // Capture fast bursts (< 100ms between chars) as a scan
  useEffect(() => {
    let buffer = ''
    let timer = null

    const handleKeyDown = (e) => {
      // Ignore if user is typing in an input field (except our own)
      const tag = e.target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        // Allow if it's our own input
        if (e.target !== inputRef.current) return
      }

      if (e.key === 'Enter' && buffer.length > 3) {
        handleLookup(buffer.trim())
        buffer = ''
        clearTimeout(timer)
        return
      }
      if (e.key.length === 1) {
        buffer += e.key
        clearTimeout(timer)
        timer = setTimeout(() => { buffer = '' }, 100)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Web NFC API — Android/Chrome only
  useEffect(() => {
    if (!('NDEFReader' in window)) return
    let reader
    try {
      reader = new window.NDEFReader()
      reader.scan().then(() => {
        reader.onreading = ({ message }) => {
          for (const record of message.records) {
            if (record.recordType === 'text') {
              const decoder = new TextDecoder(record.encoding || 'utf-8')
              handleLookup(decoder.decode(record.data))
            }
          }
        }
      }).catch(console.error)
    } catch (e) {
      // NFC not supported — silent fail
    }
  }, [])

  async function handleLookup(value) {
    setError(null)
    const member = await findMemberByNumber(value.trim())
    if (member) {
      setActiveMember(member)
      setQuery('')
    } else {
      setError(`No member found: "${value.trim()}"`)
    }
  }

  async function handleSearch(e) {
    e.preventDefault()
    if (query.trim()) await handleLookup(query)
  }

  if (activeMember) return null

  return (
    <form onSubmit={handleSearch} className="space-y-1">
      <div className="flex gap-2">
        <label htmlFor="member-lookup" className="sr-only">Member number or scan card</label>
        <div className="flex-1 relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" aria-hidden="true" />
          <input
            id="member-lookup"
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Member number or scan card..."
            className="w-full bg-slate-800 border border-slate-700 rounded-xl pl-9 pr-4 py-2.5 text-white
              placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500
              focus:border-transparent transition-colors duration-200 min-h-[44px]"
            aria-describedby={error ? 'member-lookup-error' : undefined}
          />
        </div>
        <button
          type="submit"
          aria-label="Find member"
          className="px-4 min-h-[44px] bg-slate-800 hover:bg-slate-700 text-slate-300
            hover:text-white rounded-xl text-sm transition-colors duration-200 cursor-pointer
            flex items-center gap-1.5 border border-slate-700 focus:ring-2 focus:ring-blue-500 focus:outline-none"
        >
          <ScanLine size={16} aria-hidden="true" />
          <span className="hidden sm:inline">Find</span>
        </button>
      </div>
      {error && (
        <p id="member-lookup-error" className="text-red-400 text-xs pl-1" role="alert">{error}</p>
      )}
    </form>
  )
}
