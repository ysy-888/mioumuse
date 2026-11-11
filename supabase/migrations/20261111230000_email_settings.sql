-- Marketing → E-Mail: the links and products set on each email template.
-- Same as the email_settings block in supabase-schema.sql (safe to re-run).

create table if not exists email_settings (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  template_id text not null,
  links jsonb not null default '{}'::jsonb,
  products jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, template_id)
);

alter table email_settings enable row level security;

drop policy if exists "email_settings: own rows only" on email_settings;
create policy "email_settings: own rows only" on email_settings
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
