-- Activity log: every add, change and removal in the team's data, with who
-- made it and when (Activity page, and each style's History in its pane).
--
-- Filled by triggers on the shared tables, never by the app itself, so every
-- page's edits land here without any of them having to remember to. Nobody
-- can write to it or change it from the app; the team can only read their
-- workspace's entries.
--
-- An entry:
--   action   insert | update | delete
--   changes  update: { column: { from, to } } — only the columns that changed
--              (a list column: { added: [...], removed: [...] }, or
--               { reordered: true }; very long text: { edited: true })
--            insert / delete: the row as it was (minus bookkeeping columns)
--   label    a readable name for the row ("P7903ST CREAM/BLACK", a campaign's
--            name), style_no / color for a style's history
--
-- Left out on purpose: bookkeeping columns (updated_at, imported_at…) and the
-- N41 stock numbers that refresh on every N41 import (n41_oh, n41_wip,
-- n41_oo, n41_ats, inv_qty); tables that are straight copies of an import
-- (n41_po_lines, n41_orders, po_lines, po_colors, magento_groups — the
-- imports keep their own record), chat, and each person's column layouts.
--
-- To add a new table: create trigger <table>_activity after insert or update
-- or delete on <table> for each row execute function log_activity('<key col>', ...);

create table if not exists activity_log (
  id bigint generated always as identity primary key,
  workspace_id uuid not null,
  actor_id uuid,
  at timestamptz not null default now(),
  table_name text not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  row_key text not null,
  label text,
  style_no text,
  color text,
  changes jsonb not null default '{}'::jsonb
);

create index if not exists activity_log_feed_idx on activity_log (workspace_id, at desc, id desc);
create index if not exists activity_log_style_idx on activity_log (workspace_id, style_no, at desc) where style_no is not null;

alter table activity_log enable row level security;
drop policy if exists "activity_log: team reads" on activity_log;
create policy "activity_log: team reads" on activity_log
  for select using (workspace_id = (select public.current_workspace()));
revoke insert, update, delete on activity_log from anon, authenticated;
grant select on activity_log to authenticated;

/** The trigger: its arguments are the row's key columns. */
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
      r->>'name', r->>'show', r->>'month', r->>'task_id', r->>'template_id', r->>'id'),
    r->>'style_no',
    r->>'color',
    diff
  );
  return null;
end;
$$;

revoke all on function public.log_activity() from public;

do $$
declare
  t record;
begin
  for t in select * from (values
    ('styles', 'style_no, color'),
    ('shoot_list', 'style_no, color'),
    ('style_completions', 'id'),
    ('sample_photo_links', 'style_no, color'),
    ('photoshoots', 'id'),
    ('po_fit_comments', 'po_no, style_no, round_type, round_no'),
    ('po_color_samples', 'po_no, style_no, color'),
    ('po_month_archive', 'month'),
    ('campaigns', 'id'),
    ('trade_shows', 'id'),
    ('banners', 'id'),
    ('holidays', 'id'),
    ('email_settings', 'template_id'),
    ('completed_tasks', 'task_id')
  ) as v(tbl, keys) loop
    execute format('drop trigger if exists %I on %I', t.tbl || '_activity', t.tbl);
    execute format(
      'create trigger %I after insert or update or delete on %I for each row execute function public.log_activity(%s)',
      t.tbl || '_activity', t.tbl,
      (select string_agg(quote_literal(trim(c)), ', ') from unnest(string_to_array(t.keys, ',')) c));
  end loop;
end $$;

/** Who and which areas have entries — the Activity page's filters list only these. */
create or replace function public.activity_facets()
returns table (table_name text, actor_id uuid, entries bigint)
language sql
stable
set search_path = public
as $$
  select table_name, actor_id, count(*)
  from activity_log
  where workspace_id = (select public.current_workspace())
  group by table_name, actor_id;
$$;

revoke all on function public.activity_facets() from public;
grant execute on function public.activity_facets() to authenticated;
