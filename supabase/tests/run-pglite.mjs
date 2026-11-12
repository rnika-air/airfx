// Runs the AirFx migration and security tests against real Postgres (PGlite,
// Postgres compiled to WebAssembly), with small stand-ins for the parts of
// Supabase the migration uses: the auth and storage schemas, auth.uid(),
// storage.foldername(), and the anon / authenticated roles with Supabase's
// default grants. Setup once:  cd .tools && npm install @electric-sql/pglite
// Run:  node supabase/tests/run-pglite.mjs
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const req = createRequire(resolve('.tools/package.json'));
const { PGlite } = await import(pathToFileURL(req.resolve('@electric-sql/pglite')).href);
const db = new PGlite();

const SUPABASE_STANDINS = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema storage;
create table auth.users (
  id uuid primary key, email text, instance_id uuid, aud text, role text,
  raw_user_meta_data jsonb default '{}'::jsonb, created_at timestamptz default now()
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub', '')::uuid
$$;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
create table storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text, owner_id text default (auth.uid())::text, metadata jsonb default '{}'::jsonb
);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
grant usage on schema public, auth, storage to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.buckets to anon, authenticated;
-- Supabase grants table rights to the API roles and relies on row-level security.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

let failed = 0;
const step = async (name, sql) => {
  try { await db.exec(sql); console.log(`ok    ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}: ${e.message}`); await db.exec('rollback; reset role;').catch(() => undefined); }
};

await step('Supabase stand-ins', SUPABASE_STANDINS);
for (const f of readdirSync('supabase/migrations').filter((x) => x.endsWith('.sql')).sort()) await step(`migration ${f}`, readFileSync(`supabase/migrations/${f}`, 'utf8'));
await step('row-level security: users cannot reach each other', readFileSync('supabase/tests/rls_isolation.sql', 'utf8'));

// Storage rules and plan quota.
await step('storage: own folder only, and the plan quota', `
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'a@test.invalid'), ('00000000-0000-0000-0000-0000000000b1', 'b@test.invalid');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1"}', true);
insert into storage.objects (bucket_id, name, metadata) values ('projects', '00000000-0000-0000-0000-0000000000a1/p.airfx', '{"size": 1000}');
do $$ begin
  begin
    insert into storage.objects (bucket_id, name) values ('projects', '00000000-0000-0000-0000-0000000000b1/x.airfx');
    raise exception 'FAIL: A wrote into B''s folder';
  exception when insufficient_privilege then null; end;
  begin
    insert into storage.objects (bucket_id, name) values ('other-bucket', '00000000-0000-0000-0000-0000000000a1/x');
    raise exception 'FAIL: A wrote into a bucket AirFx does not use';
  exception when insufficient_privilege or foreign_key_violation then null; end;
end $$;
-- Fill A's quota (Free: 1024 MB), then the next upload is refused.
insert into storage.objects (bucket_id, name, metadata) values ('media', '00000000-0000-0000-0000-0000000000a1/big.mp4', '{"size": 1073741824}');
do $$ begin
  if (public.my_usage() ->> 'storage_bytes')::bigint < 1073741824 then raise exception 'FAIL: usage does not count storage'; end if;
  begin
    insert into storage.objects (bucket_id, name, metadata) values ('media', '00000000-0000-0000-0000-0000000000a1/more.mp4', '{"size": 10}');
    raise exception 'FAIL: upload allowed past the plan quota';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1"}', true);
do $$ begin
  if (select count(*) from storage.objects) <> 0 then raise exception 'FAIL: B can list A''s files'; end if;
end $$;
reset role;
rollback;
`);

// Plan limits: the Free plan's project limit stops the next insert.
await step('plans: project limit enforced', `
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c1', 'c@test.invalid');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1"}', true);
insert into public.projects (name, file_path) select 'p' || g, 'x' from generate_series(1, 20) g;
do $$ begin
  begin
    insert into public.projects (name, file_path) values ('one too many', 'x');
    raise exception 'FAIL: 21st project allowed on Free';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
`);

// Error reports: anyone may add one; nobody may read them back.
await step('error reports: write-only for the public', `
begin;
set local role anon;
insert into public.client_errors (message) values ('test');
do $$ begin
  if (select count(*) from public.client_errors) <> 0 then raise exception 'FAIL: the public can read error reports'; end if;
end $$;
reset role;
rollback;
`);

// Account deletion removes the user and everything they own.
await step('delete_my_account removes the user and their rows', `
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d1', 'd@test.invalid');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1"}', true);
insert into public.projects (name, file_path) values ('mine', 'x');
select public.delete_my_account();
reset role;
do $$ begin
  if exists (select 1 from auth.users where id = '00000000-0000-0000-0000-0000000000d1') then raise exception 'FAIL: user still exists'; end if;
  if exists (select 1 from public.projects where owner = '00000000-0000-0000-0000-0000000000d1') then raise exception 'FAIL: projects left behind'; end if;
end $$;
rollback;
`);

console.log(failed ? `\n${failed} failed` : '\nAll database checks passed.');
process.exit(failed ? 1 : 0);
