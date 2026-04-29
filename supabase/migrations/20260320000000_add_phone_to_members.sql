-- supabase/migrations/20260320_add_phone_to_members.sql
alter table members add column if not exists phone text;
