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

-- Only completion is stored — the email tasks themselves are always
-- regenerated from each show's start date, so there's nothing else to keep.
create table if not exists completed_tasks (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  task_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, task_id)
);

alter table trade_shows enable row level security;
alter table completed_tasks enable row level security;

-- Dropped first so the whole file can be re-run safely.
drop policy if exists "trade_shows: own rows only" on trade_shows;
create policy "trade_shows: own rows only" on trade_shows
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "completed_tasks: own rows only" on completed_tasks;
create policy "completed_tasks: own rows only" on completed_tasks
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
