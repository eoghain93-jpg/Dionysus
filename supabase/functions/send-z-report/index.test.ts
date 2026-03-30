import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import { handler } from './index.ts'

// Stub Deno.env
const originalEnv = Deno.env.get.bind(Deno.env)
function stubEnv(key: string): string | undefined {
  if (key === 'MANAGER_EMAIL') return 'manager@example.com'
  if (key === 'RESEND_API_KEY') return 'test-key'
  return originalEnv(key)
}

const VALID_BODY = {
  reportDate: '2026-03-30',
  salesSummary: {
    totalRevenue: 450.00,
    transactionCount: 38,
    cashTotal: 120.00,
    cardTotal: 280.00,
    tabTotal: 50.00,
    refundsTotal: 15.00,
    netRevenue: 435.00,
  },
  topProducts: [
    { name: 'Guinness', qty: 42, revenue: 168.00 },
    { name: 'Lager', qty: 30, revenue: 90.00 },
  ],
  cashReconciliation: {
    openingFloat: 100.00,
    cashSales: 120.00,
    expectedInTill: 220.00,
    actualCash: 218.50,
    variance: -1.50,
  },
}

function makeRequest(body: unknown, method = 'POST') {
  return new Request('http://localhost/send-z-report', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

Deno.test('rejects non-POST requests', async () => {
  const res = await handler(makeRequest(VALID_BODY, 'GET'), stubEnv)
  assertEquals(res.status, 405)
})

Deno.test('returns 400 when body is missing reportDate', async () => {
  const { reportDate: _, ...body } = VALID_BODY
  const res = await handler(makeRequest(body), stubEnv)
  assertEquals(res.status, 400)
  const json = await res.json()
  assertEquals(json.error, 'reportDate required')
})

Deno.test('returns 400 when salesSummary missing', async () => {
  const { salesSummary: _, ...body } = VALID_BODY
  const res = await handler(makeRequest(body), stubEnv)
  assertEquals(res.status, 400)
})

Deno.test('returns 500 when MANAGER_EMAIL not configured', async () => {
  const noEmail = (key: string) => key === 'MANAGER_EMAIL' ? undefined : stubEnv(key)
  const res = await handler(makeRequest(VALID_BODY), noEmail)
  assertEquals(res.status, 500)
  const json = await res.json()
  assertEquals(json.error, 'MANAGER_EMAIL not configured')
})

Deno.test('returns 500 when RESEND_API_KEY not configured', async () => {
  const noKey = (key: string) => key === 'RESEND_API_KEY' ? undefined : stubEnv(key)
  const res = await handler(makeRequest(VALID_BODY), noKey)
  assertEquals(res.status, 500)
  const json = await res.json()
  assertEquals(json.error, 'RESEND_API_KEY not configured')
})

Deno.test('builds correct email subject with report date', async () => {
  let capturedSubject = ''
  const mockFetch = (url: string, init: RequestInit) => {
    const b = JSON.parse(init.body as string)
    capturedSubject = b.subject
    return Promise.resolve(new Response(JSON.stringify({ id: 'x' }), { status: 200 }))
  }
  const res = await handler(makeRequest(VALID_BODY), stubEnv, mockFetch as typeof fetch)
  assertEquals(res.status, 200)
  assertEquals(capturedSubject, 'Z Report — 2026-03-30')
})

Deno.test('email body includes total revenue', async () => {
  let capturedText = ''
  const mockFetch = (_url: string, init: RequestInit) => {
    const b = JSON.parse(init.body as string)
    capturedText = b.text
    return Promise.resolve(new Response(JSON.stringify({ id: 'x' }), { status: 200 }))
  }
  await handler(makeRequest(VALID_BODY), stubEnv, mockFetch as typeof fetch)
  assertEquals(capturedText.includes('£450.00'), true)
})

Deno.test('email body includes top product name', async () => {
  let capturedText = ''
  const mockFetch = (_url: string, init: RequestInit) => {
    const b = JSON.parse(init.body as string)
    capturedText = b.text
    return Promise.resolve(new Response(JSON.stringify({ id: 'x' }), { status: 200 }))
  }
  await handler(makeRequest(VALID_BODY), stubEnv, mockFetch as typeof fetch)
  assertEquals(capturedText.includes('Guinness'), true)
})

Deno.test('email body includes variance', async () => {
  let capturedText = ''
  const mockFetch = (_url: string, init: RequestInit) => {
    const b = JSON.parse(init.body as string)
    capturedText = b.text
    return Promise.resolve(new Response(JSON.stringify({ id: 'x' }), { status: 200 }))
  }
  await handler(makeRequest(VALID_BODY), stubEnv, mockFetch as typeof fetch)
  assertEquals(capturedText.includes('-£1.50'), true)
})

Deno.test('returns { sent: true } on success', async () => {
  const mockFetch = () =>
    Promise.resolve(new Response(JSON.stringify({ id: 'x' }), { status: 200 }))
  const res = await handler(makeRequest(VALID_BODY), stubEnv, mockFetch as typeof fetch)
  assertEquals(res.status, 200)
  const json = await res.json()
  assertEquals(json.sent, true)
})

Deno.test('returns 500 if Resend API call fails', async () => {
  const mockFetch = () =>
    Promise.resolve(new Response(JSON.stringify({ message: 'bad key' }), { status: 422 }))
  const res = await handler(makeRequest(VALID_BODY), stubEnv, mockFetch as typeof fetch)
  assertEquals(res.status, 500)
})

Deno.test('email includes WASTAGE section when wastage data present', async () => {
  let capturedText = ''
  const mockFetch = (_url: string, init: RequestInit) => {
    capturedText = JSON.parse(init.body as string).text
    return Promise.resolve(new Response(JSON.stringify({ id: 'x' }), { status: 200 }))
  }
  const body = {
    ...VALID_BODY,
    wastage: [{ name: 'Guinness', quantity: 4, value: 29.60 }],
    staffDrinks: [],
  }
  await handler(makeRequest(body), stubEnv, mockFetch as typeof fetch)
  assertEquals(capturedText.includes('WASTAGE'), true)
  assertEquals(capturedText.includes('Guinness'), true)
  assertEquals(capturedText.includes('×4'), true)
  assertEquals(capturedText.includes('£29.60'), true)
})

Deno.test('email includes STAFF DRINKS section when staff drinks data present', async () => {
  let capturedText = ''
  const mockFetch = (_url: string, init: RequestInit) => {
    capturedText = JSON.parse(init.body as string).text
    return Promise.resolve(new Response(JSON.stringify({ id: 'x' }), { status: 200 }))
  }
  const body = {
    ...VALID_BODY,
    wastage: [],
    staffDrinks: [{ name: 'Dave', items: 2, value: 13.40 }],
  }
  await handler(makeRequest(body), stubEnv, mockFetch as typeof fetch)
  assertEquals(capturedText.includes('STAFF DRINKS'), true)
  assertEquals(capturedText.includes('Dave'), true)
  assertEquals(capturedText.includes('2 items'), true)
  assertEquals(capturedText.includes('£13.40'), true)
})

Deno.test('email omits wastage and staff drinks sections when arrays are empty', async () => {
  let capturedText = ''
  const mockFetch = (_url: string, init: RequestInit) => {
    capturedText = JSON.parse(init.body as string).text
    return Promise.resolve(new Response(JSON.stringify({ id: 'x' }), { status: 200 }))
  }
  const body = { ...VALID_BODY, wastage: [], staffDrinks: [] }
  await handler(makeRequest(body), stubEnv, mockFetch as typeof fetch)
  assertEquals(capturedText.includes('WASTAGE'), false)
  assertEquals(capturedText.includes('STAFF DRINKS'), false)
})

Deno.test('staff drinks line uses singular item for count of 1', async () => {
  let capturedText = ''
  const mockFetch = (_url: string, init: RequestInit) => {
    capturedText = JSON.parse(init.body as string).text
    return Promise.resolve(new Response(JSON.stringify({ id: 'x' }), { status: 200 }))
  }
  const body = {
    ...VALID_BODY,
    wastage: [],
    staffDrinks: [{ name: 'Alice', items: 1, value: 4.50 }],
  }
  await handler(makeRequest(body), stubEnv, mockFetch as typeof fetch)
  assertEquals(capturedText.includes('1 item '), true)
  assertEquals(capturedText.includes('1 items'), false)
})
