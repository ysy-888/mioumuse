-- The Style Master's user2 column, shown in the app as "Show": '1', '2' or ''.
alter table styles add column if not exists show text not null default '';
