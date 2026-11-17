-- Marketing → E-Mail: swapped pictures on a template (a new hero …),
-- image key → URL. Uploads go in the public banners bucket.
alter table email_settings add column if not exists images jsonb not null default '{}'::jsonb;
