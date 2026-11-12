-- AirFx: accounts, private projects, presets, media library, plans and error reports.
-- Every user table has row-level security: a user can only ever see and change
-- their own rows. Files live in private storage buckets under "<user id>/...",
-- and storage policies enforce the same rule.

-- ───────────── Plans (Free / Pro / Studio) ─────────────
-- Limits are data, so plans can change without code. Payments are not active:
-- every account is on 'free' until billing is added.
create table public.plans (
  id text primary key,
  name text not null,
  storage_mb integer not null,          -- total cloud storage (projects + media)
  max_upload_mb integer not null,       -- largest single file
  max_projects integer not null,        -- cloud projects
  max_export_edge integer not null,     -- longest side of an export, in pixels (recorded, not enforced until paid plans exist)
  cloud_presets integer not null,
  sort integer not null default 0
);
alter table public.plans enable row level security;
create policy "plans are public" on public.plans for select using (true);

insert into public.plans (id, name, storage_mb, max_upload_mb, max_projects, max_export_edge, cloud_presets, sort) values
  ('free',   'Free',   1024,   50,   20,  3840,  100, 0),
  ('pro',    'Pro',    25600,  500,  500, 7680,  2000, 1),
  ('studio', 'Studio', 204800, 2048, 5000, 7680, 10000, 2);

-- ───────────── Profiles ─────────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  plan text not null default 'free' references public.plans (id),
  settings jsonb not null default '{}'::jsonb check (pg_column_size(settings) < 65536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "own profile: read" on public.profiles for select using (auth.uid() = id);
-- Users may edit their name and settings, never their plan.
create policy "own profile: update" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);
revoke update on public.profiles from authenticated;
grant update (display_name, settings, updated_at) on public.profiles to authenticated;

-- A profile is created with each account.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(left(new.raw_user_meta_data ->> 'display_name', 80), ''));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.touch_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();

-- ───────────── Projects ─────────────
-- The project itself is the .airfx file the editor already writes (stack,
-- settings and embedded media), stored privately in the 'projects' bucket.
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  file_path text not null,
  thumb_path text,
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  app_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_owner_updated on public.projects (owner, updated_at desc);
alter table public.projects enable row level security;
create policy "own projects: read" on public.projects for select using (auth.uid() = owner);
create policy "own projects: update" on public.projects for update using (auth.uid() = owner) with check (auth.uid() = owner);
create policy "own projects: delete" on public.projects for delete using (auth.uid() = owner);
create trigger projects_touch before update on public.projects for each row execute function public.touch_updated_at();

-- ───────────── Presets ─────────────
create table public.presets (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  local_id text not null,                 -- the editor's own preset id, for syncing
  data jsonb not null check (pg_column_size(data) < 262144),
  updated_at timestamptz not null default now(),
  unique (owner, local_id)
);
alter table public.presets enable row level security;
create policy "own presets: read" on public.presets for select using (auth.uid() = owner);
create policy "own presets: update" on public.presets for update using (auth.uid() = owner) with check (auth.uid() = owner);
create policy "own presets: delete" on public.presets for delete using (auth.uid() = owner);

-- ───────────── Media library ─────────────
create table public.media (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  mime text not null,
  file_path text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  created_at timestamptz not null default now()
);
create index media_owner_created on public.media (owner, created_at desc);
alter table public.media enable row level security;
create policy "own media: read" on public.media for select using (auth.uid() = owner);
create policy "own media: insert" on public.media for insert with check (auth.uid() = owner);
create policy "own media: delete" on public.media for delete using (auth.uid() = owner);

-- ───────────── Limits ─────────────
create function public.my_plan() returns public.plans
language sql stable security definer set search_path = '' as $$
  select p.* from public.plans p join public.profiles u on u.plan = p.id where u.id = auth.uid()
$$;

-- Bytes this user stores across every AirFx bucket.
create function public.storage_used(uid uuid default auth.uid()) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(sum((o.metadata ->> 'size')::bigint), 0)
  from storage.objects o
  where o.bucket_id in ('projects', 'media', 'thumbnails') and o.owner_id = uid::text
$$;

create function public.within_project_limit() returns boolean
language sql stable security definer set search_path = '' as $$
  select (select count(*) from public.projects where owner = auth.uid()) < (public.my_plan()).max_projects
$$;

create function public.within_preset_limit() returns boolean
language sql stable security definer set search_path = '' as $$
  select (select count(*) from public.presets where owner = auth.uid()) < (public.my_plan()).cloud_presets
$$;

-- Insert rules that use the limits (defined above, after the tables they count).
create policy "own projects: insert" on public.projects for insert with check (auth.uid() = owner and public.within_project_limit());
create policy "own presets: insert" on public.presets for insert with check (auth.uid() = owner and public.within_preset_limit());

-- What the account screen shows: plan, limits and what is used.
create function public.my_usage() returns json
language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'plan', to_json(public.my_plan()),
    'storage_bytes', public.storage_used(auth.uid()),
    'projects', (select count(*) from public.projects where owner = auth.uid()),
    'presets', (select count(*) from public.presets where owner = auth.uid()),
    'media', (select count(*) from public.media where owner = auth.uid())
  )
$$;
grant execute on function public.my_usage() to authenticated;

-- ───────────── Storage ─────────────
-- Private buckets. Paths are "<user id>/<file>"; a user can only touch their own folder.
-- The bucket size cap is the largest plan's; each plan's own cap and total quota
-- are checked by the policies and by the app before uploading.
insert into storage.buckets (id, name, public, file_size_limit) values
  ('projects', 'projects', false, 2147483648),
  ('media', 'media', false, 2147483648),
  ('thumbnails', 'thumbnails', false, 1048576)
on conflict (id) do nothing;

create policy "airfx: read own files" on storage.objects for select to authenticated
  using (bucket_id in ('projects', 'media', 'thumbnails') and (storage.foldername(name))[1] = auth.uid()::text);
create policy "airfx: add own files within quota" on storage.objects for insert to authenticated
  with check (
    bucket_id in ('projects', 'media', 'thumbnails')
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.storage_used(auth.uid()) < (public.my_plan()).storage_mb::bigint * 1048576
  );
create policy "airfx: replace own files" on storage.objects for update to authenticated
  using (bucket_id in ('projects', 'media', 'thumbnails') and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id in ('projects', 'media', 'thumbnails') and (storage.foldername(name))[1] = auth.uid()::text);
create policy "airfx: delete own files" on storage.objects for delete to authenticated
  using (bucket_id in ('projects', 'media', 'thumbnails') and (storage.foldername(name))[1] = auth.uid()::text);

-- ───────────── Deleting an account ─────────────
-- The app removes the user's files first (storage API), then calls this.
create function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  delete from auth.users where id = auth.uid();
end $$;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ───────────── Error reports ─────────────
-- The app sends unexpected errors here (no media, no personal content).
-- Anyone may add a report; nobody can read them through the API.
create table public.client_errors (
  id bigint generated always as identity primary key,
  user_id uuid default auth.uid(),
  message text not null check (char_length(message) <= 2000),
  stack text check (char_length(stack) <= 8000),
  url text check (char_length(url) <= 500),
  app_version text check (char_length(app_version) <= 40),
  user_agent text check (char_length(user_agent) <= 400),
  created_at timestamptz not null default now()
);
alter table public.client_errors enable row level security;
create policy "anyone can report errors" on public.client_errors for insert to anon, authenticated
  with check (user_id is null or user_id = auth.uid());
-- A per-user flood guard: at most 30 reports in 10 minutes.
create function public.limit_error_reports() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id is not null and (select count(*) from public.client_errors where user_id = new.user_id and created_at > now() - interval '10 minutes') >= 30 then
    return null;
  end if;
  return new;
end $$;
create trigger client_errors_flood before insert on public.client_errors for each row execute function public.limit_error_reports();
