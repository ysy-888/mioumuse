-- SO Summary is authoritative for order status; SO Detail remains line-level data.
create table if not exists public.n41_so_headers (
  user_id uuid not null default public.current_workspace(),
  order_no text not null,
  status text not null default '',
  customer_po text not null default '',
  web_order_key text not null default '',
  customer text not null default '',
  cust_name text not null default '',
  order_date date,
  ship_date date,
  cancel_date date,
  order_type text not null default '',
  total_units numeric not null default 0,
  amount numeric not null default 0,
  inv_qty numeric not null default 0,
  inv_amt numeric not null default 0,
  cancel_qty numeric not null default 0,
  open_qty numeric not null default 0,
  open_amt numeric not null default 0,
  memo text not null default '',
  imported_at timestamptz not null default now(),
  primary key (user_id, order_no)
);
create index if not exists n41_so_headers_web_idx on public.n41_so_headers (user_id, web_order_key);
alter table public.n41_so_headers enable row level security;
drop policy if exists "Team SO headers" on public.n41_so_headers;
create policy "Team SO headers" on public.n41_so_headers for all to authenticated
  using (user_id = public.current_workspace()) with check (user_id = public.current_workspace());
grant select, insert, update, delete on public.n41_so_headers to authenticated;
notify pgrst, 'reload schema';
