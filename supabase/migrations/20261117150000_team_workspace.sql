-- Shared team data.
--
-- Every table's user_id now names the team's workspace rather than the person
-- who wrote the row: it defaults to current_workspace(), and each table's
-- policy lets in everyone in that workspace. The workspace's id is the first
-- account's own id, so the rows already there stay exactly where they are.
--
-- Only people listed in team_members see anything: a signed-in account that
-- isn't on the team gets a null workspace, so no rows and no writes. To add
-- someone, create their account in Supabase (Authentication → Users), then:
--   insert into team_members (user_id, workspace_id)
--   select u.id, m.workspace_id from auth.users u, team_members m
--   where u.email = '<their email>' and m.role = 'owner';
--
-- role is there for the permissions to come; for now everyone can do everything.
-- table_views (each person's column layouts) stays personal.

create table if not exists team_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  workspace_id uuid not null,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now()
);

create index if not exists team_members_workspace_idx on team_members (workspace_id);

-- The team's first account owns the workspace (its id is the workspace's id).
insert into team_members (user_id, workspace_id, role)
select id, id, 'owner' from auth.users
order by created_at
limit 1
on conflict (user_id) do nothing;

/** The signed-in person's workspace; null when they aren't on a team. */
create or replace function public.current_workspace()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select workspace_id from public.team_members where user_id = auth.uid()
$$;

revoke all on function public.current_workspace() from public;
grant execute on function public.current_workspace() to authenticated;

alter table team_members enable row level security;
drop policy if exists "team_members: same workspace" on team_members;
create policy "team_members: same workspace" on team_members
  for select to authenticated
  using (workspace_id = (select public.current_workspace()));

-- Every shared table: the workspace's rows, for everyone on it.
do $$
declare
  t text;
begin
  foreach t in array array[
    'banners', 'campaigns', 'completed_tasks', 'email_settings', 'holidays',
    'magento_groups', 'n41_orders', 'n41_po_deleted', 'n41_po_lines',
    'photoshoots', 'po_color_samples', 'po_colors', 'po_fit_comments',
    'po_lines', 'po_month_archive', 'sample_photo_links', 'shoot_list',
    'style_completions', 'style_imports', 'styles', 'task_links', 'trade_shows'
  ] loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    execute format('alter table public.%I alter column user_id set default public.current_workspace()', t);
    execute format('drop policy if exists %I on public.%I', t || ': own rows only', t);
    execute format('drop policy if exists %I on public.%I', t || ': team rows', t);
    execute format(
      'create policy %I on public.%I for all to authenticated '
      'using (user_id = (select public.current_workspace())) '
      'with check (user_id = (select public.current_workspace()))',
      t || ': team rows', t);
  end loop;
end $$;

-- Storage: files live under the workspace's folder (the owner's id, as before).
drop policy if exists "banners: upload own" on storage.objects;
drop policy if exists "banners: update own" on storage.objects;
drop policy if exists "banners: delete own" on storage.objects;
drop policy if exists "banners: read own" on storage.objects;
drop policy if exists "fit-photos: upload own" on storage.objects;
drop policy if exists "fit-photos: read own" on storage.objects;
drop policy if exists "fit-photos: delete own" on storage.objects;

drop policy if exists "banners: team upload" on storage.objects;
create policy "banners: team upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'banners' and (storage.foldername(name))[1] = (select public.current_workspace())::text);
drop policy if exists "banners: team update" on storage.objects;
create policy "banners: team update" on storage.objects
  for update to authenticated
  using (bucket_id = 'banners' and (storage.foldername(name))[1] = (select public.current_workspace())::text);
drop policy if exists "banners: team delete" on storage.objects;
create policy "banners: team delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'banners' and (storage.foldername(name))[1] = (select public.current_workspace())::text);
drop policy if exists "banners: team read" on storage.objects;
create policy "banners: team read" on storage.objects
  for select to authenticated
  using (bucket_id = 'banners' and (storage.foldername(name))[1] = (select public.current_workspace())::text);

drop policy if exists "fit-photos: team upload" on storage.objects;
create policy "fit-photos: team upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'fit-photos' and (storage.foldername(name))[1] = (select public.current_workspace())::text);
drop policy if exists "fit-photos: team read" on storage.objects;
create policy "fit-photos: team read" on storage.objects
  for select to authenticated
  using (bucket_id = 'fit-photos' and (storage.foldername(name))[1] = (select public.current_workspace())::text);
drop policy if exists "fit-photos: team delete" on storage.objects;
create policy "fit-photos: team delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'fit-photos' and (storage.foldername(name))[1] = (select public.current_workspace())::text);

-- People: a name for each account, seen by their team (chat, and later
-- assignments). A new account gets one from its email.
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  email text not null default '',
  avatar_color text not null default '',
  updated_at timestamptz not null default now()
);

alter table profiles enable row level security;
drop policy if exists "profiles: team reads" on profiles;
create policy "profiles: team reads" on profiles
  for select to authenticated
  using (exists (
    select 1 from public.team_members m
    where m.user_id = profiles.id and m.workspace_id = (select public.current_workspace())
  ));
drop policy if exists "profiles: own edits" on profiles;
create policy "profiles: own edits" on profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create or replace function public.profile_name_from_email(email text)
returns text
language sql
immutable
as $$
  select initcap(replace(replace(split_part(coalesce(email, ''), '@', 1), '.', ' '), '_', ' '))
$$;

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), public.profile_name_from_email(new.email))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.handle_new_user_profile();

insert into profiles (id, email, display_name)
select id, coalesce(email, ''), coalesce(nullif(raw_user_meta_data->>'full_name', ''), public.profile_name_from_email(email))
from auth.users
on conflict (id) do nothing;
