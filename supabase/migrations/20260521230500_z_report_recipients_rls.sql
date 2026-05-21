-- Lock down z_report_recipients so the anon key (shipped in client bundles)
-- can't enumerate staff emails. Service role still bypasses RLS, so the
-- send-z-report edge function continues to read the list. Dashboard access
-- uses an authenticated session, also unaffected.

alter table z_report_recipients enable row level security;

-- No SELECT / INSERT / UPDATE / DELETE policies declared = anon gets nothing.
-- Service role bypasses RLS by design.
