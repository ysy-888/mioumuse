-- Marketing → E-Mail is the template editor: a template's name ('' = the
-- file's), and copies made with Save copy — rows "copy-…" holding their full
-- HTML and the folder their relative images come from, listed oldest first.
alter table email_settings add column if not exists name text not null default '';
alter table email_settings add column if not exists folder text not null default '';
alter table email_settings add column if not exists created_at timestamptz not null default now();
