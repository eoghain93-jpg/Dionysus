// PostgREST caps every response at 1000 rows. Any query that can span more
// than that — a month of orders is 3,000+ — MUST page through .range()
// until a short page signals the end, or it silently truncates.
//
// Usage:
//   const rows = await fetchAllPages(() => supabase
//     .from('orders').select('id').gte('created_at', from).lte('created_at', to))
//
// The callback must build a FRESH query each call (query builders are
// single-use); fetchAllPages appends the .range() itself.

export const PAGE_SIZE = 1000

export async function fetchAllPages(buildQuery) {
  const rows = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await buildQuery().range(offset, offset + PAGE_SIZE - 1)
    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE_SIZE) break
  }
  return rows
}
