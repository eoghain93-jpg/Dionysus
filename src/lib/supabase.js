import { createClient } from '@supabase/supabase-js'
import { auditFetch } from './audit/fetch'

// auditFetch adds the audit headers (signed-in staff session, app build) to
// database requests only — see ./audit/fetch.js for why it is safe.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  { global: { fetch: auditFetch } }
)
