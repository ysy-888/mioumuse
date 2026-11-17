-- PO detail page (js/po-detail.js).

-- Fit comments on a PO # + Style #, one row per round: PP 1, PP 2 … then
-- TOP 1, TOP 2 … Only the rounds that were used have a row. `images` lists
-- the pictures: [{ path, name }] in the private fit-photos bucket.
create table if not exists po_fit_comments (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  po_no text not null,
  style_no text not null,
  round_type text not null check (round_type in ('pp', 'top')),
  round_no int not null check (round_no > 0),
  comment text not null default '',
  images jsonb not null default '[]'::jsonb,
  comment_date date,
  updated_at timestamptz not null default now(),
  primary key (user_id, po_no, style_no, round_type, round_no)
);

alter table po_fit_comments enable row level security;
drop policy if exists "po_fit_comments: own rows only" on po_fit_comments;
create policy "po_fit_comments: own rows only" on po_fit_comments
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- The PP sample checkbox for each colour on a PO (Show samples come from
-- N41's Style Master — styles.show).
create table if not exists po_color_samples (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  po_no text not null,
  style_no text not null,
  color text not null,
  pp_sample boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, po_no, style_no, color)
);

alter table po_color_samples enable row level security;
drop policy if exists "po_color_samples: own rows only" on po_color_samples;
create policy "po_color_samples: own rows only" on po_color_samples
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Fit pictures: a private bucket (shown through short-lived signed URLs),
-- each user only in their own <user id>/ folder.
insert into storage.buckets (id, name, public)
values ('fit-photos', 'fit-photos', false)
on conflict (id) do nothing;

drop policy if exists "fit-photos: upload own" on storage.objects;
create policy "fit-photos: upload own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'fit-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "fit-photos: read own" on storage.objects;
create policy "fit-photos: read own" on storage.objects
  for select to authenticated
  using (bucket_id = 'fit-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "fit-photos: delete own" on storage.objects;
create policy "fit-photos: delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'fit-photos' and (storage.foldername(name))[1] = auth.uid()::text);
