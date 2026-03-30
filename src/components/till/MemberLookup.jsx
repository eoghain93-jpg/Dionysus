import { useState, useEffect, useRef } from 'react'
import { Search, ScanLine } from 'lucide-react'
import { Camera, X } from '../../lib/icons'
import { Html5QrcodeScanner } from 'html5-qrcode'
import { findMemberByNumber, searchMembersByName } from '../../lib/members'
import { useTillStore } from '../../stores/tillStore'

export default function MemberLookup() {
  const [query, setQuery] = useState('')
  const [error, setError] = useState(null)
  const [qrActive, setQrActive] = useState(false)
  const [suggestions, setSuggestions] = useState([])
  const debounceRef = useRef(null)
  const { activeMember, setActiveMember } = useTillStore()
  const inputRef = useRef(null)
  const scannerRef = useRef(null)

  const hasNfc = typeof NDEFReader !== 'undefined'

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
        handleLookup(decodedText)
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

  function handleSelectSuggestion(member) {
    setActiveMember(member)
    setQuery('')
    setSuggestions([])
  }

  async function handleLookup(value) {
    setError(null)
    setSuggestions([])
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
    await handleLookup(query)
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
            onChange={handleQueryChange}
            placeholder="Name or member number..."
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
        {!hasNfc && (
          <button
            type="button"
            onClick={() => qrActive ? stopScanner() : setQrActive(true)}
            aria-label={qrActive ? 'Stop QR scanning' : 'Scan QR code'}
            className="px-4 min-h-[44px] bg-slate-800 hover:bg-slate-700 text-slate-300
              hover:text-white rounded-xl text-sm transition-colors duration-200 cursor-pointer
              flex items-center gap-1.5 border border-slate-700 focus:ring-2 focus:ring-blue-500 focus:outline-none"
          >
            {qrActive ? <X size={16} aria-hidden="true" /> : <Camera size={16} aria-hidden="true" />}
            <span className="hidden sm:inline">{qrActive ? 'Stop scanning' : 'Scan QR'}</span>
          </button>
        )}
      </div>
      {suggestions.length > 0 && (
        <ul className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
          {suggestions.map(m => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => handleSelectSuggestion(m)}
                className="w-full text-left px-4 py-2.5 text-sm text-white hover:bg-slate-700 flex items-center justify-between"
              >
                <span>{m.name}</span>
                <span className="text-slate-500 text-xs font-mono">{m.membership_number}</span>
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
