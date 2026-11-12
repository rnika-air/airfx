-- Checks that one user cannot read or change another user's projects, presets,
-- media or files. Run in the Supabase SQL editor (or psql) after the migration.
-- It works inside a transaction and rolls everything back.
begin;

-- Two throwaway users.
insert into auth.users (id, email, instance_id, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'rls-a@test.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', 'rls-b@test.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');

-- Act as user A: create a project and a preset.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
insert into public.projects (name, file_path) values ('A project', '00000000-0000-0000-0000-00000000000a/p.airfx');
insert into public.presets (local_id, data) values ('a1', '{"name":"A preset"}');

do $$ begin
  if (select count(*) from public.projects) <> 1 then raise exception 'A should see their own project'; end if;
  if (select (public.my_usage() ->> 'projects')::int) <> 1 then raise exception 'usage should count 1 project'; end if;
end $$;

-- Act as user B.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
do $$ begin
  if (select count(*) from public.projects) <> 0 then raise exception 'FAIL: B can see A''s projects'; end if;
  if (select count(*) from public.presets) <> 0 then raise exception 'FAIL: B can see A''s presets'; end if;
  if (select count(*) from public.profiles) <> 1 then raise exception 'FAIL: B should see only their own profile'; end if;
end $$;
update public.projects set name = 'hacked';           -- affects nothing for B
delete from public.projects;                          -- affects nothing for B
do $$ begin
  begin
    insert into public.projects (owner, name, file_path) values ('00000000-0000-0000-0000-00000000000a', 'forged', 'x');
    raise exception 'FAIL: B could create a project owned by A';
  exception when insufficient_privilege or check_violation then null; -- refused, as it should be
  end;
  begin
    update public.profiles set plan = 'studio';
    raise exception 'FAIL: B could change their own plan';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Back as A: the project is untouched.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
do $$ begin
  if (select name from public.projects limit 1) <> 'A project' then raise exception 'FAIL: A''s project was changed by B'; end if;
end $$;

reset role;
select 'RLS isolation: all checks passed' as result;
rollback;
