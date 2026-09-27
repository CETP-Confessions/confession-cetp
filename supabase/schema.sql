create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.profiles(id) on delete cascade,
  message text,
  media_path text,
  media_type text,
  created_at timestamptz not null default now(),
  is_read boolean not null default false
);

create index if not exists idx_profiles_username on public.profiles(username);
create index if not exists idx_messages_admin_created on public.messages(admin_id, created_at desc);
create index if not exists idx_messages_read on public.messages(admin_id, is_read);

alter table public.profiles enable row level security;
alter table public.messages enable row level security;

create policy "Public profiles are readable by exact username lookup"
on public.profiles
for select
using (true);

create policy "Users can insert their own profile"
on public.profiles
for insert
with check (auth.uid() = id);

create policy "Users can update their own profile"
on public.profiles
for update
using (auth.uid() = id)
with check (auth.uid() = id);

create policy "Admins can read only their own messages"
on public.messages
for select
using (auth.uid() = admin_id);

create policy "Anonymous visitors can submit only to valid usernames"
on public.messages
for insert
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = admin_id
  )
);

create policy "Admins can update their own messages"
on public.messages
for update
using (auth.uid() = admin_id)
with check (auth.uid() = admin_id);

create policy "Admins can delete their own messages"
on public.messages
for delete
using (auth.uid() = admin_id);

create policy "Anonymous visitors cannot read message rows"
on public.messages
for select
using (false);

create or replace function public.insert_anonymous_message(
  p_username text,
  p_message text,
  p_media_path text default null,
  p_media_type text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
  v_message_id uuid;
begin
  select id into v_admin_id
  from public.profiles
  where username = p_username;

  if v_admin_id is null then
    raise exception 'Profile not found';
  end if;

  insert into public.messages (admin_id, message, media_path, media_type)
  values (v_admin_id, p_message, p_media_path, p_media_type)
  returning id into v_message_id;

  return v_message_id;
end;
$$;

grant execute on function public.insert_anonymous_message(text, text, text, text) to anon;

-- NOTE: keep the profile table limited to the auth user ID and username only.
-- Do not add an email column here; email belongs to auth.users.

