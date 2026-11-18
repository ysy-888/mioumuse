-- N41 sales orders: every line of N41's Sales Orders export (the .csv with
-- division, orderdate, … orderno, sod_id …), for the N41 Orders page and its
-- SO detail page — plus the team's comments on each SO.
--
-- Import N41 Sales Orders saves the lines here (one row per sod_id — N41's
-- order line id) and, as before, each web order's status in n41_orders for
-- Magento → Orders. An export covers a date range, so an import adds and
-- updates lines and never clears others.

create table if not exists n41_so_lines (
  user_id uuid not null default public.current_workspace(),
  sod_id bigint not null,
  order_no text not null,
  line integer,
  status text not null default '',
  order_type text not null default '',
  order_date date,
  ship_date date,
  cancel_date date,
  line_cancel_date date,
  customer text not null default '',
  store text not null default '',
  cust_name text not null default '',
  customer_type text not null default '',
  contact text not null default '',
  email text not null default '',
  phone text not null default '',
  address text not null default '',
  city text not null default '',
  state text not null default '',
  zip text not null default '',
  customer_po text not null default '',
  terms text not null default '',
  payment_code text not null default '',
  ship_via text not null default '',
  price_level text not null default '',
  style_no text not null default '',
  color text not null default '',
  description text not null default '',
  category text not null default '',
  season text not null default '',
  size_cat text not null default '',
  -- [{ size, qty, open }] for each size with a name: ordered and still open.
  sizes jsonb not null default '[]'::jsonb,
  total_units numeric not null default 0,
  price numeric not null default 0,
  ext_price numeric not null default 0,
  ship_qty numeric not null default 0,
  inv_qty numeric not null default 0,
  inv_amt numeric not null default 0,
  cancel_qty numeric not null default 0,
  cancel_amt numeric not null default 0,
  open_qty numeric not null default 0,
  open_amt numeric not null default 0,
  memo text not null default '',
  imported_at timestamptz not null default now(),
  primary key (user_id, sod_id)
);

create index if not exists n41_so_lines_order_idx on n41_so_lines (user_id, order_no);
create index if not exists n41_so_lines_customer_idx on n41_so_lines (user_id, customer);

alter table n41_so_lines enable row level security;
drop policy if exists "n41_so_lines: team rows" on n41_so_lines;
create policy "n41_so_lines: team rows" on n41_so_lines
  for all using (user_id = (select public.current_workspace()))
  with check (user_id = (select public.current_workspace()));

-- Comments on an SO, by whoever wrote them (the SO page's right-hand panel).
create table if not exists n41_so_comments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default public.current_workspace(),
  order_no text not null,
  author_id uuid not null default auth.uid(),
  body text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now(),
  edited_at timestamptz
);

create index if not exists n41_so_comments_order_idx on n41_so_comments (user_id, order_no, created_at);

alter table n41_so_comments enable row level security;
drop policy if exists "n41_so_comments: team reads" on n41_so_comments;
create policy "n41_so_comments: team reads" on n41_so_comments
  for select using (user_id = (select public.current_workspace()));
drop policy if exists "n41_so_comments: team writes" on n41_so_comments;
create policy "n41_so_comments: team writes" on n41_so_comments
  for insert with check (user_id = (select public.current_workspace()) and author_id = auth.uid());
-- Only the author edits or deletes their own.
drop policy if exists "n41_so_comments: author edits" on n41_so_comments;
create policy "n41_so_comments: author edits" on n41_so_comments
  for update using (user_id = (select public.current_workspace()) and author_id = auth.uid())
  with check (user_id = (select public.current_workspace()) and author_id = auth.uid());
drop policy if exists "n41_so_comments: author deletes" on n41_so_comments;
create policy "n41_so_comments: author deletes" on n41_so_comments
  for delete using (user_id = (select public.current_workspace()) and author_id = auth.uid());

-- Comments show up live for everyone on the SO.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'n41_so_comments') then
    alter publication supabase_realtime add table n41_so_comments;
  end if;
end $$;

-- The activity log (lines are an import copy, so only comments are logged).
drop trigger if exists n41_so_comments_activity on n41_so_comments;
create trigger n41_so_comments_activity after insert or update or delete on n41_so_comments
  for each row execute function public.log_activity('id');
