-- shoot_list.method was already there from an older version of the app
-- (not null, default 'shoot'; values 'shoot' / 'ai'), so the column added in
-- 20261112200000 was a no-op and saving an undecided style (method null)
-- failed. Make it what the app now expects: photoshoot | cg | null.
alter table shoot_list alter column method drop not null;
alter table shoot_list alter column method drop default;
update shoot_list set method = null where method = 'shoot';  -- the old default: not a choice
update shoot_list set method = 'cg' where method = 'ai';     -- made with AI = CG
