-- Which samples a colour has, so its sample status (the one taken to the
-- photoshoot: TOP / SHOW / PP) can only be one that exists.
--
--   pp_samples   how many PP samples are in: 0–3 (PP1, PP2, PP3 — ticked in
--                order, so it's a count)
--   top_sample   the TOP sample is in
--   show         (already there) the Style Master's user2 — show samples
--
-- Ticked in the style pane and on a PO's detail page. The production sheet
-- import (TOP comments in) ticks TOP too.
--
-- The earlier per-PO PP tick (po_color_samples) is no longer used; it had no
-- ticks. Colours already set to TOP or PP get that sample ticked, so their
-- status stays valid. (Not logged as activity: it's the setup, not an edit.)

alter table styles
  add column if not exists pp_samples smallint not null default 0 check (pp_samples between 0 and 3),
  add column if not exists top_sample boolean not null default false;

alter table styles disable trigger styles_activity;

update styles set top_sample = true
where not top_sample and (sample_status = 'top' or coalesce(top_date::text, '') <> '');

update styles set pp_samples = 1
where pp_samples = 0 and sample_status = 'pp';

alter table styles enable trigger styles_activity;
