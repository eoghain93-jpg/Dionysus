-- supabase/migrations/20260330_staff_pin.sql
-- Add hashed PIN storage for staff members.
-- Nullable: only staff members need a PIN. Regular members leave this null.
alter table members add column if not exists pin_hash text;
