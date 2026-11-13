-- N41's record id for each Style # + Color (the Style Master's "id" column).
-- It stays the same when N41 changes a record's Style # or colour, so the
-- import matches on it first and can carry a rename across.
alter table styles add column if not exists n41_id bigint;
create index if not exists styles_n41_id_idx on styles (user_id, n41_id);

-- Rename a Style # + Color everywhere the app keeps it, in one go: the style
-- itself, Need to Shoot, photoshoots, banners, the Complete history and
-- sample photo links. If the new name already has a row (an earlier import
-- added it as a new style), the old one is folded into it: the new row keeps
-- its own values and takes the old one's IHD / notes / TOP only where it
-- has none, and the old row goes.
create or replace function rename_style(old_style text, old_color text, new_style text, new_color text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  hit jsonb := jsonb_build_array(jsonb_build_object('styleNo', old_style, 'color', old_color));
begin
  if uid is null then raise exception 'Not signed in'; end if;
  if old_style = new_style and old_color = new_color then return; end if;

  if exists (select 1 from styles where user_id = uid and style_no = new_style and color = new_color) then
    update styles n set
      ihd = coalesce(n.ihd, o.ihd),
      notes = case when n.notes = '' then o.notes else n.notes end,
      top_date = case when n.top_date = '' then o.top_date else n.top_date end,
      top_po = case when n.top_po = '' then o.top_po else n.top_po end
    from styles o
    where n.user_id = uid and n.style_no = new_style and n.color = new_color
      and o.user_id = uid and o.style_no = old_style and o.color = old_color;
    delete from styles where user_id = uid and style_no = old_style and color = old_color;
  else
    update styles set style_no = new_style, color = new_color
    where user_id = uid and style_no = old_style and color = old_color;
  end if;

  if exists (select 1 from shoot_list where user_id = uid and style_no = new_style and color = new_color) then
    delete from shoot_list where user_id = uid and style_no = old_style and color = old_color;
  else
    update shoot_list set style_no = new_style, color = new_color
    where user_id = uid and style_no = old_style and color = old_color;
  end if;

  if exists (select 1 from sample_photo_links where user_id = uid and style_no = new_style and color = new_color) then
    delete from sample_photo_links where user_id = uid and style_no = old_style and color = old_color;
  else
    update sample_photo_links set style_no = new_style, color = new_color
    where user_id = uid and style_no = old_style and color = old_color;
  end if;

  update style_completions set style_no = new_style, color = new_color
  where user_id = uid and style_no = old_style and color = old_color;

  -- [{ styleNo, color, … }] lists: the matching entries renamed, order and other keys kept.
  update photoshoots set styles = (
    select jsonb_agg(case when e->>'styleNo' = old_style and e->>'color' = old_color
      then e || jsonb_build_object('styleNo', new_style, 'color', new_color) else e end order by i)
    from jsonb_array_elements(styles) with ordinality as t(e, i))
  where user_id = uid and styles @> hit;

  update banners set styles = (
    select jsonb_agg(case when e->>'styleNo' = old_style and e->>'color' = old_color
      then e || jsonb_build_object('styleNo', new_style, 'color', new_color) else e end order by i)
    from jsonb_array_elements(styles) with ordinality as t(e, i))
  where user_id = uid and styles @> hit;
end;
$$;

grant execute on function rename_style(text, text, text, text) to authenticated;
