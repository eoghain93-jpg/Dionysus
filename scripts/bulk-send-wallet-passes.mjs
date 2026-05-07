// Bulk-send wallet pass emails to all members.
//
// One-off seed used after Google Wallet issuer was approved for production.
// Iterates every member with an email, calls send-wallet-pass-email per
// member, logs successes / failures. Sequential (not parallel) to avoid
// rate-limit hits on Resend / walletwallet.dev / Google.
//
// Run: node scripts/bulk-send-wallet-passes.mjs
//      Reads VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY from env (.env.local).

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
)

const { data: members, error } = await supabase
  .from('members')
  .select('id, name, email, membership_number')
  .eq('active', true)
  .not('email', 'is', null)
  .order('membership_number')

if (error) {
  console.error('Failed to fetch members:', error)
  process.exit(1)
}

console.log(`Fetched ${members.length} active members with email addresses.`)

const results = { sent: [], failed: [] }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

for (const m of members) {
  process.stdout.write(`[${m.membership_number}] ${m.name.padEnd(24)} → ${m.email.padEnd(35)} `)
  try {
    const { error } = await supabase.functions.invoke('send-wallet-pass-email', {
      body: { member_id: m.id },
    })
    if (error) throw error
    console.log('OK')
    results.sent.push(m)
  } catch (err) {
    console.log(`FAIL — ${err.message ?? err}`)
    results.failed.push({ ...m, error: err.message ?? String(err) })
  }
  // gentle pacing — 750ms between sends
  await sleep(750)
}

console.log('')
console.log('═'.repeat(60))
console.log(`Sent:   ${results.sent.length}`)
console.log(`Failed: ${results.failed.length}`)
if (results.failed.length) {
  console.log('')
  console.log('Failures:')
  for (const f of results.failed) console.log(`  ${f.membership_number} ${f.name} (${f.email}): ${f.error}`)
}
