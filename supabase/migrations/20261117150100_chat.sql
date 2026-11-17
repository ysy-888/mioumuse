-- Messages: direct messages and group chats between people on the team
-- (js/chat.js). Only a chat's members see it or its messages. Chats are
-- started, joined, renamed and marked read through the functions below, so
-- the tables themselves only take new messages and leaving a group.

create table if not exists chat_conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_workspace(),
  kind text not null check (kind in ('dm', 'group')),
  title text not null default '',
  -- Two people's ids, sorted: one direct message per pair.
  dm_key text unique,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create table if not exists chat_members (
  conversation_id uuid not null references chat_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create index if not exists chat_members_user_idx on chat_members (user_id);

create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references chat_conversations(id) on delete cascade,
  sender_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  body text not null default '',
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  check (deleted_at is not null or char_length(body) between 1 and 8000)
);

create index if not exists chat_messages_conversation_idx on chat_messages (conversation_id, created_at desc);

/** Whether the signed-in person is in this chat (for the policies, without them looking at themselves). */
create or replace function public.is_chat_member(conv uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.chat_members where conversation_id = conv and user_id = auth.uid())
$$;

revoke all on function public.is_chat_member(uuid) from public;
grant execute on function public.is_chat_member(uuid) to authenticated;

alter table chat_conversations enable row level security;
alter table chat_members enable row level security;
alter table chat_messages enable row level security;

drop policy if exists "chat_conversations: members read" on chat_conversations;
create policy "chat_conversations: members read" on chat_conversations
  for select to authenticated
  using (public.is_chat_member(id));

drop policy if exists "chat_members: members read" on chat_members;
create policy "chat_members: members read" on chat_members
  for select to authenticated
  using (public.is_chat_member(conversation_id));

drop policy if exists "chat_members: leave a group" on chat_members;
create policy "chat_members: leave a group" on chat_members
  for delete to authenticated
  using (
    user_id = auth.uid()
    and exists (select 1 from public.chat_conversations c where c.id = conversation_id and c.kind = 'group')
  );

drop policy if exists "chat_messages: members read" on chat_messages;
create policy "chat_messages: members read" on chat_messages
  for select to authenticated
  using (public.is_chat_member(conversation_id));

drop policy if exists "chat_messages: members send" on chat_messages;
create policy "chat_messages: members send" on chat_messages
  for insert to authenticated
  with check (sender_id = auth.uid() and deleted_at is null and edited_at is null and public.is_chat_member(conversation_id));

-- A new message moves its chat up the list, and counts as read by whoever sent it.
create or replace function public.chat_after_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chat_conversations set last_message_at = new.created_at where id = new.conversation_id;
  update public.chat_members set last_read_at = greatest(last_read_at, new.created_at)
    where conversation_id = new.conversation_id and user_id = new.sender_id;
  return new;
end;
$$;

drop trigger if exists chat_messages_after_insert on chat_messages;
create trigger chat_messages_after_insert
  after insert on chat_messages
  for each row execute function public.chat_after_message();

/** Everyone given must be on the caller's team. */
create or replace function public.chat_require_team(ids uuid[])
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  ws uuid := public.current_workspace();
begin
  if ws is null then
    raise exception 'You''re not on a team yet.';
  end if;
  if exists (
    select 1 from unnest(ids) as x(id)
    where not exists (select 1 from public.team_members m where m.user_id = x.id and m.workspace_id = ws)
  ) then
    raise exception 'Everyone in a chat has to be on the team.';
  end if;
  return ws;
end;
$$;

/** The direct message with someone, started if there isn't one yet. */
create or replace function public.chat_start_dm(other uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  ws uuid;
  key text;
  conv uuid;
begin
  if other is null or other = me then
    raise exception 'Pick someone else to message.';
  end if;
  ws := public.chat_require_team(array[other]);
  key := least(me::text, other::text) || ':' || greatest(me::text, other::text);
  insert into public.chat_conversations (workspace_id, kind, dm_key, created_by)
  values (ws, 'dm', key, me)
  on conflict (dm_key) do nothing;
  select id into conv from public.chat_conversations where dm_key = key;
  insert into public.chat_members (conversation_id, user_id)
  values (conv, me), (conv, other)
  on conflict do nothing;
  return conv;
end;
$$;

/** A new group chat with these people (and the caller). */
create or replace function public.chat_create_group(group_title text, member_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  ws uuid;
  conv uuid;
begin
  ws := public.chat_require_team(coalesce(member_ids, '{}'));
  insert into public.chat_conversations (workspace_id, kind, title, created_by)
  values (ws, 'group', left(trim(coalesce(group_title, '')), 120), me)
  returning id into conv;
  insert into public.chat_members (conversation_id, user_id)
  select conv, x from unnest(array_append(coalesce(member_ids, '{}'), me)) as t(x)
  on conflict do nothing;
  return conv;
end;
$$;

/** Add people to a group the caller is in. */
create or replace function public.chat_add_members(conv uuid, member_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_chat_member(conv) then
    raise exception 'You''re not in that chat.';
  end if;
  if not exists (select 1 from public.chat_conversations where id = conv and kind = 'group') then
    raise exception 'People can only be added to a group chat.';
  end if;
  perform public.chat_require_team(coalesce(member_ids, '{}'));
  insert into public.chat_members (conversation_id, user_id)
  select conv, x from unnest(member_ids) as t(x)
  on conflict do nothing;
end;
$$;

/** Rename a group the caller is in. */
create or replace function public.chat_rename(conv uuid, new_title text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_chat_member(conv) then
    raise exception 'You''re not in that chat.';
  end if;
  update public.chat_conversations set title = left(trim(coalesce(new_title, '')), 120)
  where id = conv and kind = 'group';
end;
$$;

/** Everything in the chat up to now has been seen. */
create or replace function public.chat_mark_read(conv uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.chat_members set last_read_at = greatest(last_read_at, now())
  where conversation_id = conv and user_id = auth.uid()
$$;

/** Change the text of one of your own messages. */
create or replace function public.chat_edit_message(message uuid, new_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if char_length(trim(coalesce(new_body, ''))) not between 1 and 8000 then
    raise exception 'A message needs some text.';
  end if;
  update public.chat_messages set body = new_body, edited_at = now()
  where id = message and sender_id = auth.uid() and deleted_at is null;
end;
$$;

/** Take back one of your own messages (it shows as deleted). */
create or replace function public.chat_delete_message(message uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.chat_messages set body = '', deleted_at = now()
  where id = message and sender_id = auth.uid() and deleted_at is null
$$;

/** The caller's chats, newest first: members, last message, unread count. */
create or replace function public.chat_inbox()
returns table (
  id uuid,
  kind text,
  title text,
  last_message_at timestamptz,
  last_read_at timestamptz,
  member_ids uuid[],
  last_body text,
  last_sender_id uuid,
  last_deleted boolean,
  unread_count int
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id, c.kind, c.title, c.last_message_at, me.last_read_at,
    (select array_agg(m.user_id order by m.joined_at) from public.chat_members m where m.conversation_id = c.id),
    lm.body, lm.sender_id, lm.deleted_at is not null,
    (select count(*)::int from public.chat_messages x
      where x.conversation_id = c.id and x.created_at > me.last_read_at and x.sender_id <> auth.uid() and x.deleted_at is null)
  from public.chat_members me
  join public.chat_conversations c on c.id = me.conversation_id
  left join lateral (
    select body, sender_id, deleted_at from public.chat_messages
    where conversation_id = c.id order by created_at desc limit 1
  ) lm on true
  where me.user_id = auth.uid()
  order by c.last_message_at desc
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'chat_require_team(uuid[])', 'chat_start_dm(uuid)', 'chat_create_group(text, uuid[])',
    'chat_add_members(uuid, uuid[])', 'chat_rename(uuid, text)', 'chat_mark_read(uuid)',
    'chat_edit_message(uuid, text)', 'chat_delete_message(uuid)', 'chat_inbox()'
  ] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Live: new messages, edits, and chats someone adds you to.
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['chat_messages', 'chat_members', 'chat_conversations'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
