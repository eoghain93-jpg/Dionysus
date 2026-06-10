-- Register the production till devices.
--
-- Applied in the same db push as 20260610170000_till_device_rls.sql so the
-- policies and the device registrations land together — no window where a
-- signed-in till is locked out waiting for a manual insert.
--
-- The auth users were created in production on 2026-06-10
-- (till-1@fairmile.club, till-2@fairmile.club). The WHERE EXISTS guard makes
-- this a no-op on databases that don't have those users (local staging,
-- fresh environments) instead of a foreign-key failure.

insert into till_devices (auth_user_id, till_id, name)
select v.id, v.till_id, v.name
from (values
  ('8c2c1870-5625-44db-b4d3-4352651340dc'::uuid, 'till-1', 'Main bar till'),
  ('37e48d38-694b-4e84-81c0-d37963a2e1e6'::uuid, 'till-2', 'Second till')
) as v(id, till_id, name)
where exists (select 1 from auth.users u where u.id = v.id)
on conflict (auth_user_id) do nothing;
