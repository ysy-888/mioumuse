-- Marketing → E-Mail: a template's HTML as edited in the HTML window
-- ('' = use the template file's).
alter table email_settings add column if not exists html text not null default '';
