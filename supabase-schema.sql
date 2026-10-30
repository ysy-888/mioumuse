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

-- ── Mailchimp: which task is linked to which Mailchimp campaign ─────────────
--
-- One row per linked task (task ids as in completed_tasks). `sent_seen` flips
-- once the app has ticked the task off for a sent campaign, so a task you
-- untick by hand afterwards stays unticked.

create table if not exists task_links (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  task_id text not null,
  mc_campaign_id text not null,
  sent_seen boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, task_id)
);

alter table task_links enable row level security;

drop policy if exists "task_links: own rows only" on task_links;
create policy "task_links: own rows only" on task_links
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── Styles database (imported from the N41 ATS Excel export) ────────────────
--
-- One row per Style # + Color. Re-importing updates changed fields and adds
-- new rows; styles missing from a newer file are kept as they are.

create table if not exists styles (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  style_no text not null,
  color text not null,
  n41_status text not null default '',
  season text not null default '',
  category text not null default '',
  description text not null default '',
  updated_at timestamptz not null default now(),
  primary key (user_id, style_no, color)
);

alter table styles enable row level security;

drop policy if exists "styles: own rows only" on styles;
create policy "styles: own rows only" on styles
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- style_imports: one row per Excel import that saved anything (Styles →
-- menu → Update history). `added` and `changed` keep every record the import
-- touched, so a past import can be looked through in full:
--   added    [{ styleNo, color, status, season, category, description }]
--   changed  [{ styleNo, color, status, season, category, description,
--               diffs: [{ key, from, to }] }]    -- values after the import

create table if not exists style_imports (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  imported_at timestamptz not null default now(),
  file_name text not null default '',
  total_count integer not null default 0,
  added_count integer not null default 0,
  changed_count integer not null default 0,
  unchanged_count integer not null default 0,
  added jsonb not null default '[]',
  changed jsonb not null default '[]'
);

create index if not exists style_imports_user_time on style_imports (user_id, imported_at desc);

alter table style_imports enable row level security;

drop policy if exists "style_imports: own rows only" on style_imports;
create policy "style_imports: own rows only" on style_imports
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── Photoshoots ─────────────────────────────────────────────────────────────
--
-- shoot_list: the Need to Shoot flag on a Style # + Color. shot_shoot_id is
-- set when a shoot with it is marked complete (and cleared if reopened).

create table if not exists shoot_list (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  style_no text not null,
  color text not null,
  added_at timestamptz not null default now(),
  shot_shoot_id text,
  shot_at timestamptz,
  primary key (user_id, style_no, color)
);

create table if not exists photoshoots (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null default '',
  shoot_date date not null,
  model text not null default '',
  shoot_type text not null default 'studio',   -- studio | editorial
  notes text not null default '',
  status text not null default 'planned',      -- planned | complete
  completed_at timestamptz,
  styles jsonb not null default '[]',          -- [{ styleNo, color }]
  created_at timestamptz not null default now()
);

alter table shoot_list enable row level security;
alter table photoshoots enable row level security;

drop policy if exists "shoot_list: own rows only" on shoot_list;
create policy "shoot_list: own rows only" on shoot_list
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "photoshoots: own rows only" on photoshoots;
create policy "photoshoots: own rows only" on photoshoots
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Styles gained an IHD (in-house date), entered in the app — the ATS import
-- never sends it, so re-importing leaves it alone.
alter table styles add column if not exists ihd date;

-- ── Magento groups (Magento tab → Import groups) ────────────────────────────
--
-- Which Simple items belong to each Grouped product, exactly as Magento has
-- them — read from a Magento product export (its associated_skus column),
-- since Magento's API leaves disabled items out of a group. One row per
-- Grouped product; an import replaces them all. Nothing else is stored.

create table if not exists magento_groups (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  group_sku text not null,
  child_skus jsonb not null default '[]',     -- in the group's order
  imported_at timestamptz not null default now(),
  primary key (user_id, group_sku)
);

alter table magento_groups enable row level security;

drop policy if exists "magento_groups: own rows only" on magento_groups;
create policy "magento_groups: own rows only" on magento_groups
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── N41 sales orders (Magento → Orders → Import N41 Sales Orders) ───────────
-- Each web order on N41's Sales Orders report, to compare with Magento. Run this
-- once in the SQL Editor.
create table if not exists n41_orders (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  order_no text not null,                     -- digits of Cust. PO #, no leading zeros
  po_no text not null default '',             -- as on the report: Web:00000061
  customer text not null default '',
  status text not null default '',            -- Closed only if every row is Closed
  imported_at timestamptz not null default now(),
  primary key (user_id, order_no)
);

alter table n41_orders add column if not exists so_no text not null default '';  -- comma-separated when an order has several

alter table n41_orders enable row level security;

drop policy if exists "n41_orders: own rows only" on n41_orders;
create policy "n41_orders: own rows only" on n41_orders
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── Table views (header menu → Table view) ──────────────────────────────────
--
-- One row per user per table: which columns show, and in what order, so a
-- view follows the login from computer to computer. `table_id` is the
-- table's id in index.html, e.g. 'mgProductsTable'.

create table if not exists table_views (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  table_id text not null,
  col_order jsonb not null default '[]',      -- every column key, in order
  hidden jsonb not null default '[]',         -- the keys not shown
  updated_at timestamptz not null default now(),
  primary key (user_id, table_id)
);

alter table table_views enable row level security;

drop policy if exists "table_views: own rows only" on table_views;
create policy "table_views: own rows only" on table_views
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
