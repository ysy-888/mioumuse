-- Need to Shoot: how each style gets its pictures — a photoshoot, or CG.
-- null until it's decided. (The type — New Style / New Color / Recut — now
-- comes from the style's PO; `reason` keeps what it was when added.)
alter table shoot_list add column if not exists method text;  -- photoshoot | cg
