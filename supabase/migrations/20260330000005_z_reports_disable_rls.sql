-- z_reports has no per-user data; RLS is not needed
alter table z_reports disable row level security;
