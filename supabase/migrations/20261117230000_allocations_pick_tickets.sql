-- Allocation and pick tickets (Sales › Customers).
--
-- An SO line's open units are allocated (so_allocations, one row per line,
-- by size), then allocated lines are put on a pick ticket (pick_tickets).
-- Voiding a ticket puts its lines back to allocated; deleting an allocation
-- puts the line back to open. N41 itself isn't written to.

create table if not exists pick_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default public.current_workspace(),
  ticket_no bigint generated always as identity,
  customer text not null,
  status text not null default 'open' check (status in ('open', 'picked')),
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  picked_at timestamptz
);

create index if not exists pick_tickets_customer_idx on pick_tickets (user_id, customer);

create table if not exists so_allocations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default public.current_workspace(),
  sod_id bigint not null,
  order_no text not null,
  customer text not null,
  style_no text,
  color text,
  sizes jsonb not null default '[]'::jsonb, -- [{ size, qty }]
  qty numeric not null default 0,
  pick_ticket_id uuid references pick_tickets (id) on delete set null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (user_id, sod_id)
);

create index if not exists so_allocations_customer_idx on so_allocations (user_id, customer);
create index if not exists so_allocations_ticket_idx on so_allocations (pick_ticket_id);

alter table pick_tickets enable row level security;
drop policy if exists "pick_tickets: team rows" on pick_tickets;
create policy "pick_tickets: team rows" on pick_tickets
  for all using (user_id = (select public.current_workspace()))
  with check (user_id = (select public.current_workspace()));

alter table so_allocations enable row level security;
drop policy if exists "so_allocations: team rows" on so_allocations;
create policy "so_allocations: team rows" on so_allocations
  for all using (user_id = (select public.current_workspace()))
  with check (user_id = (select public.current_workspace()));

-- Teammates see each other's allocating as it happens.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'so_allocations') then
    alter publication supabase_realtime add table so_allocations;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'pick_tickets') then
    alter publication supabase_realtime add table pick_tickets;
  end if;
end $$;

drop trigger if exists so_allocations_activity on so_allocations;
create trigger so_allocations_activity after insert or update or delete on so_allocations
  for each row execute function public.log_activity('order_no', 'style_no', 'color');
drop trigger if exists pick_tickets_activity on pick_tickets;
create trigger pick_tickets_activity after insert or update or delete on pick_tickets
  for each row execute function public.log_activity('id');

-- Activity log: a pick ticket is labelled "PT 12". Same function as 20261117210100, with ticket_no.
create or replace function public.log_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  r jsonb := coalesce(n, o);
  skip text[] := array['user_id', 'updated_at', 'created_at', 'imported_at', 'ats_at',
    'n41_oh', 'n41_wip', 'n41_oo', 'n41_ats', 'inv_qty', 'n41_id', 'linked_at', 'added_at'];
  diff jsonb := '{}'::jsonb;
  k text;
  ov jsonb;
  nv jsonb;
  added jsonb;
  removed jsonb;
  ws uuid := (r->>'user_id')::uuid;
  rk text;
begin
  if ws is null then return null; end if;

  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(n) loop
      continue when k = any(skip);
      ov := o->k;
      nv := n->k;
      continue when ov is not distinct from nv;
      if jsonb_typeof(ov) = 'array' and jsonb_typeof(nv) = 'array' then
        select coalesce(jsonb_agg(e), '[]'::jsonb) into added
          from jsonb_array_elements(nv) e
          where not exists (select 1 from jsonb_array_elements(ov) x where x = e);
        select coalesce(jsonb_agg(e), '[]'::jsonb) into removed
          from jsonb_array_elements(ov) e
          where not exists (select 1 from jsonb_array_elements(nv) x where x = e);
        diff := diff || jsonb_build_object(k,
          case when added = '[]'::jsonb and removed = '[]'::jsonb
            then jsonb_build_object('reordered', true)
            else jsonb_build_object('added', added, 'removed', removed) end);
      elsif length(coalesce(ov::text, '')) > 1000 or length(coalesce(nv::text, '')) > 1000 then
        diff := diff || jsonb_build_object(k, jsonb_build_object('edited', true));
      else
        diff := diff || jsonb_build_object(k, jsonb_build_object('from', ov, 'to', nv));
      end if;
    end loop;
    -- Nothing that counts changed (an import re-saving the same values).
    if diff = '{}'::jsonb then return null; end if;
  else
    select coalesce(jsonb_object_agg(key,
             case when length(value::text) > 1000 then '"(long)"'::jsonb else value end), '{}'::jsonb)
      into diff
      from jsonb_each(r)
      where not (key = any(skip)) and value <> 'null'::jsonb;
  end if;

  select string_agg(coalesce(r->>c, ''), ' · ') into rk from unnest(tg_argv) c;

  insert into activity_log (workspace_id, actor_id, table_name, action, row_key, label, style_no, color, changes)
  values (
    ws,
    auth.uid(),
    tg_table_name,
    lower(tg_op),
    coalesce(rk, ''),
    coalesce(
      nullif(concat_ws(' ', r->>'po_no', coalesce(r->>'style_no', r->>'style'), r->>'color'), ''),
      r->>'name', r->>'show', r->>'month', r->>'task_id', r->>'template_id',
      case when r ? 'ticket_no' then 'PT ' || (r->>'ticket_no') end,
      case when r ? 'order_no' then 'SO ' || (r->>'order_no') end, r->>'id'),
    r->>'style_no',
    r->>'color',
    diff
  );
  return null;
end;
$$;
