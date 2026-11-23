-- Only named people may lift a tab block.
--
-- Any staff member can block a tab, but unblocking is limited to members
-- flagged can_unblock_tabs: the owner's new "Admin" login and Nikki Seville
-- (STF-002). The rule is enforced here, not just hidden in the till:
--
--   * unblock_tab(member) checks who is signed in on the till from the
--     server-side staff session (auditlog.ctx(), not anything the browser
--     sends) and refuses anyone without can_unblock_tabs.
--   * a trigger refuses any other route from blocked -> unblocked made
--     through the API, so a stale till bundle doing a plain UPDATE can't
--     get round it. The Supabase dashboard / SQL editor are unaffected.

alter table members add column if not exists can_unblock_tabs boolean not null default false;

-- The owner's own staff login. No PIN yet: the first person to choose
-- "Admin" on the till sign-in screen is asked to set one.
insert into members (name, membership_number, membership_tier, active, can_unblock_tabs)
select 'Admin', 'STF-ADMIN', 'staff', true, true
where not exists (select 1 from members where membership_number = 'STF-ADMIN');

update members set can_unblock_tabs = true
 where membership_number in ('STF-ADMIN', 'STF-002');

create or replace function unblock_tab(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auditlog, extensions
as $$
declare
  c auditlog.context := auditlog.ctx();
begin
  if c.actor in ('member', 'anon') then
    raise exception 'permission denied' using errcode = 'insufficient_privilege';
  end if;
  if c.actor = 'till' and not exists (
       select 1 from members where id = c.staff_id and can_unblock_tabs) then
    raise exception 'Only Admin or Nikki can unblock a tab'
      using errcode = 'insufficient_privilege';
  end if;

  perform set_config('tabs.unblock_ok', 'on', true);
  update members
     set tab_blocked = false, tab_blocked_at = null, tab_blocked_by = null
   where id = p_member_id;
  perform set_config('tabs.unblock_ok', '', true);
end;
$$;

revoke execute on function unblock_tab(uuid) from public, anon;
grant execute on function unblock_tab(uuid) to authenticated;

create or replace function members_guard_tab_unblock()
returns trigger
language plpgsql
security definer
set search_path = public, auditlog, extensions
as $$
begin
  if old.tab_blocked and not new.tab_blocked
     and coalesce(current_setting('tabs.unblock_ok', true), '') <> 'on'
     and (auditlog.ctx()).actor in ('till', 'member', 'anon') then
    raise exception 'Only Admin or Nikki can unblock a tab'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists members_guard_tab_unblock on members;
create trigger members_guard_tab_unblock
  before update of tab_blocked on members
  for each row execute function members_guard_tab_unblock();
