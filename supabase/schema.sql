create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,24}$'),
  display_name text not null default '',
  e2ee_public_key text,
  created_at timestamptz not null default now()
);
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  direct_pair_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create table if not exists public.e2ee_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_name text not null default 'Устройство',
  public_key text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique(user_id, public_key)
);
create table if not exists public.messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

create unique index if not exists profiles_username_lower_uidx on public.profiles (lower(username));
create unique index if not exists conversations_direct_pair_uidx on public.conversations (direct_pair_key) where direct_pair_key is not null;

create index if not exists messages_conversation_created_idx on public.messages(conversation_id, created_at desc);
create index if not exists conversation_members_user_idx on public.conversation_members(user_id);

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare requested_username text;
begin
  requested_username := lower(coalesce(new.raw_user_meta_data ->> 'username', ''));
  if requested_username !~ '^[a-z0-9_]{3,24}$' then
    raise exception 'Username must be 3-24 characters: a-z, 0-9, underscore';
  end if;
  insert into public.profiles(id, username, display_name)
  values(new.id, requested_username, coalesce(new.raw_user_meta_data ->> 'display_name', ''));
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public, anon, authenticated;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function private.is_conversation_member(check_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.conversation_members
    where conversation_id = check_conversation_id
      and user_id = (select auth.uid())
  );
$$;
revoke all on function private.is_conversation_member(uuid) from public, anon;
grant execute on function private.is_conversation_member(uuid) to authenticated;

create or replace function private.open_direct_conversation(target_username text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $
declare
  target_id uuid;
  current_conversation uuid;
  new_conversation uuid;
  pair_key text;
  caller_id uuid := (select auth.uid());
begin
  if caller_id is null then raise exception 'Not authenticated'; end if;
  if target_username is null
     or length(trim(target_username)) not between 3 and 24
     or lower(trim(target_username)) !~ '^[a-z0-9_]{3,24}
revoke all on function private.open_direct_conversation(text) from public, anon;
grant execute on function private.open_direct_conversation(text) to authenticated;

create or replace function public.open_direct_conversation(target_username text)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.open_direct_conversation(target_username);
$$;
revoke all on function public.open_direct_conversation(text) from public, anon;
grant execute on function public.open_direct_conversation(text) to authenticated;

alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.e2ee_devices enable row level security;
alter table public.messages enable row level security;
drop policy if exists "Users read own devices" on public.e2ee_devices;
create policy "Users read own devices" on public.e2ee_devices for select to authenticated
using (user_id = (select auth.uid()));
drop policy if exists "Users register own devices" on public.e2ee_devices;
create policy "Users register own devices" on public.e2ee_devices for insert to authenticated
with check (user_id = (select auth.uid()));
drop policy if exists "Users update own devices" on public.e2ee_devices;
create policy "Users update own devices" on public.e2ee_devices for update to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));


drop policy if exists "Profiles visible to signed-in users" on public.profiles;
create policy "Profiles visible to signed-in users"
on public.profiles for select to authenticated using (true);

drop policy if exists "Users update own profile" on public.profiles;
create policy "Users update own profile"
on public.profiles for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

drop policy if exists "Members read conversations" on public.conversations;
create policy "Members read conversations"
on public.conversations for select to authenticated
using (private.is_conversation_member(id));

drop policy if exists "Members read membership" on public.conversation_members;
create policy "Members read membership"
on public.conversation_members for select to authenticated
using (private.is_conversation_member(conversation_id));

drop policy if exists "Members read messages" on public.messages;
create policy "Members read messages"
on public.messages for select to authenticated
using (private.is_conversation_member(conversation_id));

drop policy if exists "Members send messages as themselves" on public.messages;
create policy "Members send messages as themselves"
on public.messages for insert to authenticated
with check (
  sender_id = (select auth.uid())
  and private.is_conversation_member(conversation_id)
);

grant usage on schema public to authenticated;
grant select on public.profiles, public.conversations, public.conversation_members, public.messages to authenticated;
grant update(display_name, e2ee_public_key) on public.profiles to authenticated;
grant insert on public.messages to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end;
$$;
 then
    raise exception 'Invalid username';
  end if;

  select p.id into target_id
  from public.profiles p
  where lower(p.username) = lower(trim(target_username))
  limit 1;

  if target_id is null then raise exception 'User not found'; end if;
  if target_id = caller_id then raise exception 'Cannot create a chat with yourself'; end if;

  pair_key := least(caller_id::text,target_id::text) || ':' || greatest(caller_id::text,target_id::text);

  select c.id into current_conversation
  from public.conversations c
  join public.conversation_members mine
    on mine.conversation_id = c.id and mine.user_id = caller_id
  join public.conversation_members theirs
    on theirs.conversation_id = c.id and theirs.user_id = target_id
  where (select count(*) from public.conversation_members cm where cm.conversation_id = c.id) = 2
  order by c.created_at asc
  limit 1;

  if current_conversation is not null then
    update public.conversations set direct_pair_key = pair_key
    where id = current_conversation and direct_pair_key is null;
    return current_conversation;
  end if;

  insert into public.conversations(created_by,direct_pair_key)
  values(caller_id,pair_key)
  on conflict (direct_pair_key) where direct_pair_key is not null do nothing
  returning id into new_conversation;

  if new_conversation is null then
    select c.id into new_conversation from public.conversations c where c.direct_pair_key = pair_key;
  else
    insert into public.conversation_members(conversation_id,user_id)
    values(new_conversation,caller_id),(new_conversation,target_id);
  end if;
  return new_conversation;
end;
$;
revoke all on function private.open_direct_conversation(text) from public, anon;
grant execute on function private.open_direct_conversation(text) to authenticated;

create or replace function public.open_direct_conversation(target_username text)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.open_direct_conversation(target_username);
$$;
revoke all on function public.open_direct_conversation(text) from public, anon;
grant execute on function public.open_direct_conversation(text) to authenticated;

alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;

drop policy if exists "Profiles visible to signed-in users" on public.profiles;
create policy "Profiles visible to signed-in users"
on public.profiles for select to authenticated using (true);

drop policy if exists "Users update own profile" on public.profiles;
create policy "Users update own profile"
on public.profiles for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

drop policy if exists "Members read conversations" on public.conversations;
create policy "Members read conversations"
on public.conversations for select to authenticated
using (private.is_conversation_member(id));

drop policy if exists "Members read membership" on public.conversation_members;
create policy "Members read membership"
on public.conversation_members for select to authenticated
using (private.is_conversation_member(conversation_id));

drop policy if exists "Members read messages" on public.messages;
create policy "Members read messages"
on public.messages for select to authenticated
using (private.is_conversation_member(conversation_id));

drop policy if exists "Members send messages as themselves" on public.messages;
create policy "Members send messages as themselves"
on public.messages for insert to authenticated
with check (
  sender_id = (select auth.uid())
  and private.is_conversation_member(conversation_id)
);

grant usage on schema public to authenticated;
grant select on public.profiles, public.conversations, public.conversation_members, public.messages to authenticated;
grant update(display_name, e2ee_public_key) on public.profiles to authenticated;
grant insert on public.messages to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end;
$$;

grant select, insert, update on public.e2ee_devices to authenticated;
