const PRINTER_IP_KEY = 'printer_ip'
const WEBPRNT_PATH = '/StarWebPRNT/SendMessage'

export function getPrinterIp() {
  return localStorage.getItem(PRINTER_IP_KEY)
}

function pad(n) {
  return String(n).padStart(2, '0')
}

function formatDate(isoString) {
  const d = new Date(isoString)
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}  ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function buildReceiptXml({ orderId, total, paymentMethod, createdAt, includeDrawer }) {
  const dateTime = formatDate(createdAt)
  const receiptRef = String(orderId).slice(-8).toUpperCase()
  const methodLabel = paymentMethod.charAt(0).toUpperCase() + paymentMethod.slice(1)
  const totalStr = `\u00a3${Number(total).toFixed(2)}`
  const drawerXml = includeDrawer
    ? '\n    <peripheral channel="1" type="openDrawer"/>'
    : ''

  return `<?xml version="1.0" encoding="utf-8"?>
<root>
  <document>
    <align mode="center"/>
    <bold/>
    <text>THE FAIRMILE SPORTS &amp; SOCIAL CLUB\n</text>
    <bold_cancel/>
    <text>\n</text>
    <align mode="left"/>
    <text>${dateTime}\n</text>
    <text>Receipt #${receiptRef}\n</text>
    <text>${methodLabel}\n</text>
    <text>\n</text>
    <bold/>
    <text>TOTAL: ${totalStr}\n</text>
    <bold_cancel/>
    <text>\n</text>
    <align mode="center"/>
    <text>Thank you for your visit\n</text>
    <feed line="3"/>
    <cut type="partial"/>${drawerXml}
  </document>
</root>`
}

function buildDrawerXml() {
  return `<?xml version="1.0" encoding="utf-8"?>
<root>
  <document>
    <peripheral channel="1" type="openDrawer"/>
  </document>
</root>`
}

async function sendXml(ip, xml) {
  const res = await fetch(`http://${ip}${WEBPRNT_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/xml' },
    body: xml,
  })
  if (!res.ok) {
    throw new Error(`Printer returned ${res.status}`)
  }
}

export async function printReceipt({ orderId, total, paymentMethod, createdAt }) {
  const ip = getPrinterIp()
  const xml = buildReceiptXml({
    orderId,
    total,
    paymentMethod,
    createdAt,
    includeDrawer: paymentMethod === 'cash',
  })
  if (!ip) {
    console.info('[starPrinter] Simulation mode — no IP set:\n', xml)
    return
  }
  await sendXml(ip, xml)
}

export async function openDrawer() {
  const ip = getPrinterIp()
  const xml = buildDrawerXml()
  if (!ip) {
    console.info('[starPrinter] Simulation mode — no IP set:\n', xml)
    return
  }
  await sendXml(ip, xml)
}
