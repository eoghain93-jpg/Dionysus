import { useState, useEffect, useRef } from 'react'
import { Search, ScanLine } from 'lucide-react'
import { Camera, X } from '../../lib/icons'
import { Html5QrcodeScanner } from 'html5-qrcode'
import { findMemberByNumber, searchMembersByName } from '../../lib/members'
import { useTillStore } from '../../stores/tillStore'
import { logEvent } from '../../lib/audit/log'
import { useSessionStore } from '../../stores/sessionStore'

export default function MemberLookup() {
  const [query, setQuery] = useState('')
  const [error, setError] = useState(null)
  const [qrActive, setQrActive] = useState(false)
  const [suggestions, setSuggestions] = useState([])
  const debounceRef = useRef(null)
  const { activeMember, setActiveMember } = useTillStore()
  const inputRef = useRef(null)
  const scannerRef = useRef(null)
  // When the last scanner burst was seen (audit: tells a scan from typing).
  const scanAtRef = useRef(0)

  const hasNfc = typeof NDEFReader !== 'undefined'

  // Auto-focus the search input whenever no member is selected. Removes the
  // need for staff to click into the box before scanning a wallet pass —
  // the QR data lands directly in the field and submits on Enter.
  useEffect(() => {
    if (!activeMember && inputRef.current) {
      inputRef.current.focus()
    }
  }, [activeMember])

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
        scanAtRef.current = Date.now()
        handleLookup(buffer.trim(), 'scan')
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
          // A locked till keeps this page mounted underneath the lock
          // screen; a card tapped then must not attach a member to the order.
          if (useSessionStore.getState().locked) return
          for (const record of message.records) {
            if (record.recordType === 'text') {
              const decoder = new TextDecoder(record.encoding || 'utf-8')
              handleLookup(decoder.decode(record.data), 'scan')
            }
          }
        }
      }).catch(console.error)
    } catch (e) {
      // NFC not supported — silent fail
    }
  }, [])

  // Camera QR scanner — start/stop based on qrActive state
  useEffect(() => {
    if (!qrActive) return

    const scanner = new Html5QrcodeScanner(
      'qr-reader',
      { fps: 10, qrbox: { width: 250, height: 250 } },
      /* verbose= */ false
    )
    scannerRef.current = scanner

    scanner.render(
      (decodedText) => {
        stopScanner()
        handleLookup(decodedText, 'scan')
      },
      (errorMessage) => {
        // scan errors are expected while scanning — ignore
      }
    )

    return () => {
      stopScanner()
    }
  }, [qrActive])

  function stopScanner() {
    if (scannerRef.current) {
      scannerRef.current.clear().catch(() => {})
      scannerRef.current = null
    }
    setQrActive(false)
  }

  function handleQueryChange(e) {
    const val = e.target.value
    setQuery(val)
    setError(null)
    setSuggestions([])
    clearTimeout(debounceRef.current)
    // If it looks like a membership number, don't show name suggestions
    if (!val.trim() || /^M?\d/i.test(val.trim())) return
    debounceRef.current = setTimeout(async () => {
      const results = await searchMembersByName(val.trim())
      setSuggestions(results)
    }, 250)
  }

  // How the member got onto the sale: a scanned card is evidence they were
  // there; a typed number or a name picked from a list is the staff member's
  // word. A scanner types into the focused box AND presses Enter, so one scan
  // arrives twice (scan burst + form submit): the submit that follows a burst
  // counts as the same scan, and only the first to attach the member is logged.
  function attachMember(member, method) {
    const already = useTillStore.getState().activeMember?.id === member.id
    setActiveMember(member)
    if (!already) {
      logEvent('cart.member_attached', { member_id: member.id, member_name: member.name, method })
    }
  }

  function handleSelectSuggestion(member) {
    attachMember(member, 'search')
    setQuery('')
    setSuggestions([])
  }

  async function handleLookup(value, method = 'number') {
    setError(null)
    setSuggestions([])
    const member = await findMemberByNumber(value.trim())
    if (member) {
      attachMember(member, method)
      setQuery('')
    } else {
      setError(`No member found: "${value.trim()}"`)
    }
  }

  async function handleSearch(e) {
    e.preventDefault()
    if (!query.trim()) return
    // If suggestions are already showing, select the first one
    if (suggestions.length > 0) {
      handleSelectSuggestion(suggestions[0])
      return
    }
    // If it looks like a name (not a membership number), search by name
    if (!/^M?\d/i.test(query.trim())) {
      const results = await searchMembersByName(query.trim())
      if (results.length === 1) {
        handleSelectSuggestion(results[0])
      } else if (results.length > 1) {
        setSuggestions(results)
      } else {
        setError(`No member found: "${query.trim()}"`)
      }
      return
    }
    await handleLookup(query, Date.now() - scanAtRef.current < 500 ? 'scan' : 'number')
  }

  if (activeMember) return null

  return (
    <form onSubmit={handleSearch} className="relative space-y-1">
      <div className="flex gap-2">
        <label htmlFor="member-lookup" className="sr-only">Member number or scan card</label>
        <div className="flex-1 relative">
          <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" aria-hidden="true" />
          <input
            id="member-lookup"
            ref={inputRef}
            value={query}
            onChange={handleQueryChange}
            placeholder="Find member — name or member number"
            className="w-full bg-slate-800 border border-slate-700 rounded-xl pl-11 pr-4 text-white
              placeholder-slate-400 text-base focus:outline-none focus:ring-2 focus:ring-blue-500
              focus:border-transparent transition-colors duration-200 min-h-[48px]"
            aria-describedby={error ? 'member-lookup-error' : undefined}
          />
        </div>
        <button
          type="submit"
          aria-label="Find member"
          className="px-4 min-h-[48px] bg-slate-800 hover:bg-slate-700 text-slate-100
            hover:text-white rounded-xl text-[15px] font-bold transition-colors duration-200 cursor-pointer
            flex items-center gap-1.5 border border-slate-700 focus:ring-2 focus:ring-blue-500 focus:outline-none"
        >
          <ScanLine size={16} aria-hidden="true" />
          <span className="hidden sm:inline">Find</span>
        </button>
        {!hasNfc && (
          <button
            type="button"
            onClick={() => qrActive ? stopScanner() : setQrActive(true)}
            aria-label={qrActive ? 'Stop QR scanning' : 'Scan QR code'}
            className="px-4 min-h-[48px] bg-slate-800 hover:bg-slate-700 text-slate-100
              hover:text-white rounded-xl text-[15px] font-bold transition-colors duration-200 cursor-pointer
              flex items-center gap-1.5 border border-slate-700 focus:ring-2 focus:ring-blue-500 focus:outline-none"
          >
            {qrActive ? <X size={16} aria-hidden="true" /> : <Camera size={16} aria-hidden="true" />}
            <span className="hidden sm:inline">{qrActive ? 'Stop scanning' : 'Scan QR'}</span>
          </button>
        )}
      </div>
      {suggestions.length > 0 && (
        <ul className="absolute left-0 right-0 top-full mt-1 z-30 bg-slate-800 border border-blue-900 rounded-2xl overflow-hidden shadow-2xl">
          {suggestions.map(m => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => handleSelectSuggestion(m)}
                className="w-full text-left px-4 min-h-[56px] text-base font-semibold text-white hover:bg-slate-700 flex items-center justify-between gap-3 cursor-pointer"
              >
                <span>{m.name}</span>
                <span className="flex items-center gap-3 text-sm font-semibold">
                  {m.tab_blocked && <span className="text-red-300">Tab blocked</span>}
                  <span className="text-slate-400 font-mono">{m.membership_number}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {qrActive && (
        <div id="qr-reader" className="mt-2 rounded-xl overflow-hidden" />
      )}
      {error && (
        <p id="member-lookup-error" className="text-red-400 text-xs pl-1" role="alert">{error}</p>
      )}
    </form>
  )
}
