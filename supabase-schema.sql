-- Practice CRM — Supabase schema
--
-- One-time setup:
--   1. Create a project at supabase.com (free tier is plenty for this).
--   2. Project → SQL Editor → New query → paste this whole file → Run.
--   3. Authentication → Users → Add user. Create the one account you'll
--      sign in with (email + password, "Auto Confirm User" checked so you
--      don't need to click an email link).
--   4. Project Settings → API → copy the Project URL and the anon/public
--      key into js/config.js (SUPABASE_URL / SUPABASE_ANON_KEY).
--
-- Row Level Security scopes every row to whoever is signed in — the anon key
-- that ends up in the app's public JS is safe to publish, because without a
-- valid session for one of your users these tables return nothing at all.

create table if not exists owners (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  email text not null default '',
  phone text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists companies (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  owner_id text references owners(id) on delete set null,
  location text not null default '',
  state text not null default '',
  -- The payroll groups (schedule, anchor date, employees) as one JSON blob —
  -- they're always read and written together, so a nested table would just
  -- be more round trips for no real benefit at this scale.
  payroll_groups jsonb not null default '[]',
  payroll_tax text not null default '',
  sales_tax text not null default '',
  services jsonb not null default '{}',
  -- The accounts reconciled each month. A documented list per company, in
  -- the same shape as payroll_groups: read and written whole.
  bookkeeping_accounts jsonb not null default '[]',
  notes text not null default '',
  created_at timestamptz not null default now()
);

-- Only completion is stored — the tasks themselves are always regenerated
-- from each company's schedule, so there's nothing else to keep here.
create table if not exists completed_tasks (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  task_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, task_id)
);

-- Existing projects: this column was added after the first release, so bring
-- it in without touching anything else.
alter table companies add column if not exists bookkeeping_accounts jsonb not null default '[]';

alter table owners enable row level security;
alter table companies enable row level security;
alter table completed_tasks enable row level security;

create policy "owners: own rows only" on owners
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "companies: own rows only" on companies
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "completed_tasks: own rows only" on completed_tasks
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
