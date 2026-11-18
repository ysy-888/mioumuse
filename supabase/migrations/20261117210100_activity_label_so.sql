-- Activity log: an SO comment is labelled by its SO ("SO 142509"), not its id.
-- Same function as 20261117170000_activity_log.sql, with order_no in the label.

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
      case when r ? 'order_no' then 'SO ' || (r->>'order_no') end, r->>'id'),
    r->>'style_no',
    r->>'color',
    diff
  );
  return null;
end;
$$;
