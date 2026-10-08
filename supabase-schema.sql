-- Mioumuse — Supabase schema
--
-- One-time setup:
--   1. Create a project at supabase.com (free tier is plenty for this).
--   2. Project → SQL Editor → New query → paste this whole file → Run.
--   3. Authentication → Users → Add user. Create the account you'll sign in
--      with (email + password, "Auto Confirm User" checked so you don't need
--      to click an email link).
--   4. Project Settings → API → copy the Project URL and the anon/public
--      key into js/config.js (SUPABASE_URL / SUPABASE_ANON_KEY).
--
-- Row Level Security scopes every row to whoever is signed in — the anon key
-- that ends up in the app's public JS is safe to publish, because without a
-- valid session for one of your users these tables return nothing at all.

create table if not exists trade_shows (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- One of the TRADE_SHOWS keys in js/config.js, e.g. 'magic-las-vegas'.
  show text not null,
  start_date date not null,
  end_date date not null,
  notes text not null default '',
  created_at timestamptz not null default now(),
  constraint trade_shows_dates_in_order check (end_date >= start_date)
);

create table if not exists campaigns (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- One of the CAMPAIGN_TYPES keys in js/config.js, e.g. 'sale'.
  type text not null default 'sale',
  name text not null default '',
  start_date date not null,
  end_date date not null,
  -- Weekdays it runs on, 0 = Sunday … 6 = Saturday; [] = every day.
  weekdays jsonb not null default '[]',
  -- The campaign's tasks, [{ id, category, dueDate }], read and written whole.
  tasks jsonb not null default '[]',
  notes text not null default '',
  created_at timestamptz not null default now(),
  constraint campaigns_dates_in_order check (end_date >= start_date)
);

-- Only completion is stored — the email tasks themselves are always
-- regenerated from each show's start date, so there's nothing else to keep.
create table if not exists completed_tasks (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  task_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, task_id)
);

alter table trade_shows enable row level security;
alter table campaigns enable row level security;
alter table completed_tasks enable row level security;

-- Dropped first so the whole file can be re-run safely.
drop policy if exists "trade_shows: own rows only" on trade_shows;
create policy "trade_shows: own rows only" on trade_shows
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "campaigns: own rows only" on campaigns;
create policy "campaigns: own rows only" on campaigns
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "completed_tasks: own rows only" on completed_tasks;
create policy "completed_tasks: own rows only" on completed_tasks
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Existing projects: weekdays was added after campaigns first shipped, so
-- bring it in without touching anything else.
alter table campaigns add column if not exists weekdays jsonb not null default '[]';

-- ── Platforms: banners ──────────────────────────────────────────────────────

create table if not exists banners (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- One of the PLATFORMS keys in js/config.js, e.g. 'faire'.
  platform text not null,
  name text not null,
  width integer,
  height integer,
  -- Path of the image in the 'banners' storage bucket, or '' for none.
  image_path text not null default '',
  -- [{ styleNo, color }], 1 to 4 of them.
  styles jsonb not null default '[]',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table banners enable row level security;

drop policy if exists "banners: own rows only" on banners;
create policy "banners: own rows only" on banners
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Banner images. Readable by URL (they're shown on public storefronts anyway)
-- so the app can display them directly; only the signed-in user can add,
-- replace or delete them, and only inside their own <user id>/ folder.
insert into storage.buckets (id, name, public)
values ('banners', 'banners', true)
on conflict (id) do nothing;

drop policy if exists "banners: upload own" on storage.objects;
create policy "banners: upload own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'banners' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "banners: update own" on storage.objects;
create policy "banners: update own" on storage.objects
  for update to authenticated
  using (bucket_id = 'banners' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "banners: delete own" on storage.objects;
create policy "banners: delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'banners' and (storage.foldername(name))[1] = auth.uid()::text);

-- Deleting through the API also needs read access to the object itself.
drop policy if exists "banners: read own" on storage.objects;
create policy "banners: read own" on storage.objects
  for select to authenticated
  using (bucket_id = 'banners' and (storage.foldername(name))[1] = auth.uid()::text);

-- Banners gained a type, and can run on several platforms: `platforms` holds
-- them all and replaces the single `platform` column, which is kept (now
-- optional) so nothing saved before is lost.
alter table banners add column if not exists banner_type text not null default 'collection';
alter table banners add column if not exists platforms jsonb not null default '[]';
alter table banners alter column platform drop not null;
update banners set platforms = jsonb_build_array(platform)
  where platforms = '[]'::jsonb and platform is not null;
