// Print Bridge
//
// Tiny HTTP-to-TCP proxy. The browser POSTs raw printer bytes to this bridge
// running on localhost; the bridge opens a TCP socket to the printer's port
// 9100 and writes them through. Used because the mC-Print3 firmware on this
// unit accepts WebPRNT POSTs but never produces paper, while raw port 9100
// prints reliably (with a form feed to flush the buffer).
//
// Usage:   node scripts/print-bridge.mjs
//          npm run bridge

import http from 'node:http'
import net from 'node:net'

const BRIDGE_PORT = Number(process.env.PRINT_BRIDGE_PORT) || 3001
const PRINTER_TCP_PORT = 9100
const PRINTER_TIMEOUT_MS = 5000

function sendToPrinter(ip, payload) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(PRINTER_TCP_PORT, ip)
    let settled = false
    const finish = (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (err) reject(err)
      else resolve()
    }
    const timer = setTimeout(() => {
      sock.destroy()
      finish(new Error(`Connect timeout to ${ip}:${PRINTER_TCP_PORT}`))
    }, PRINTER_TIMEOUT_MS)

    sock.once('connect', () => {
      clearTimeout(timer)
      // Resolve as soon as bytes are flushed to the kernel — don't wait for
      // the printer to FIN the socket. Some Star units hold the socket open
      // for >10s after a print, which would block the HTTP response and
      // trigger the browser-side AbortController.
      sock.write(payload, () => {
        sock.end()
        finish()
      })
    })
    sock.once('error', err => finish(err))
  })
}

const server = http.createServer(async (req, res) => {
  // Wide-open CORS — bridge runs on the same machine as the dev server.
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Printer-IP')
  res.setHeader('Access-Control-Allow-Private-Network', 'true')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'POST only' }))
    return
  }

  const ip = req.headers['x-printer-ip']
  if (!ip || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'Missing or invalid X-Printer-IP header' }))
    return
  }

  const chunks = []
  let totalBytes = 0
  req.on('data', chunk => {
    chunks.push(chunk)
    totalBytes += chunk.length
    if (totalBytes > 1024 * 1024) {
      req.destroy()
    }
  })
  req.on('end', async () => {
    const payload = Buffer.concat(chunks)
    try {
      await sendToPrinter(ip, payload)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, bytes: payload.length }))
      console.log(`[bridge] sent ${payload.length} bytes to ${ip}:${PRINTER_TCP_PORT}`)
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: err.message }))
      console.error(`[bridge] error: ${err.message}`)
    }
  })
})

server.listen(BRIDGE_PORT, '127.0.0.1', () => {
  console.log(`[bridge] listening on http://127.0.0.1:${BRIDGE_PORT}`)
  console.log(`[bridge] POST raw printer bytes with X-Printer-IP header`)
})
