begin;

alter table public.messages
  add column if not exists status text not null default 'pending',
  add column if not exists is_pinned boolean not null default false;

update public.messages
set status = 'pending'
where status is null or status not in ('pending', 'approved', 'rejected');

alter table public.messages alter column status set default 'pending';
alter table public.messages alter column status set not null;

DO $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'messages_status_check'
      and conrelid = 'public.messages'::regclass
  ) then
    alter table public.messages
      add constraint messages_status_check check (status in ('pending', 'approved', 'rejected'));
  end if;
end;
$$;

create table if not exists public.message_comments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  comment_text text,
  media_path text,
  media_type text,
  created_at timestamptz not null default now(),
  status text not null default 'pending',
  constraint message_comments_status_check check (status in ('pending', 'approved', 'rejected')),
  constraint message_comments_content_check check (
    nullif(btrim(comment_text), '') is not null or media_path is not null
  )
);

alter table public.messages enable row level security;
alter table public.message_comments enable row level security;

 drop policy if exists "Admins can read only their own messages" on public.messages;
drop policy if exists "Anonymous visitors can submit only to valid usernames" on public.messages;
drop policy if exists "Admins can update their own messages" on public.messages;
drop policy if exists "Admins can delete their own messages" on public.messages;
drop policy if exists "Anonymous visitors cannot read message rows" on public.messages;
drop policy if exists "Admins can read own messages" on public.messages;
drop policy if exists "Admins can moderate own messages" on public.messages;
drop policy if exists "Admins can delete own messages" on public.messages;

drop policy if exists "Users can insert their own profile" on public.profiles;
drop policy if exists "Users can update their own profile" on public.profiles;
drop policy if exists "Public profiles are readable by exact username lookup" on public.profiles;
drop policy if exists "Admins can read own profile" on public.profiles;
create policy "Admins can read own profile"
on public.profiles for select to authenticated
using (auth.uid() = id);
revoke all on public.profiles from public, anon, authenticated;
revoke insert, update, delete on public.profiles from authenticated;
grant select on public.profiles to authenticated;

create policy "Admins can read own messages"
on public.messages for select to authenticated
using (auth.uid() = admin_id);

create policy "Admins can moderate own messages"
on public.messages for update to authenticated
using (auth.uid() = admin_id)
with check (auth.uid() = admin_id);

create policy "Admins can delete own messages"
on public.messages for delete to authenticated
using (auth.uid() = admin_id);

 drop policy if exists "Admins can read own comments" on public.message_comments;
drop policy if exists "Admins can moderate own comments" on public.message_comments;
drop policy if exists "Admins can delete own comments" on public.message_comments;

create policy "Admins can read own comments"
on public.message_comments for select to authenticated
using (exists (
  select 1 from public.messages m
  where m.id = message_comments.message_id
    and m.admin_id = auth.uid()
));

create policy "Admins can moderate own comments"
on public.message_comments for update to authenticated
using (exists (
  select 1 from public.messages m
  where m.id = message_comments.message_id
    and m.admin_id = auth.uid()
))
with check (exists (
  select 1 from public.messages m
  where m.id = message_comments.message_id
    and m.admin_id = auth.uid()
));

create policy "Admins can delete own comments"
on public.message_comments for delete to authenticated
using (exists (
  select 1 from public.messages m
  where m.id = message_comments.message_id
    and m.admin_id = auth.uid()
));

revoke all on public.messages from public, anon, authenticated;
revoke all on public.message_comments from public, anon, authenticated;
grant select, delete on public.messages to authenticated;
grant update (status, is_pinned, is_read) on public.messages to authenticated;
grant select, delete on public.message_comments to authenticated;
grant update (status) on public.message_comments to authenticated;

create index if not exists idx_messages_status_created
  on public.messages(status, created_at desc);
create index if not exists idx_messages_admin_status
  on public.messages(admin_id, status, created_at desc);
create index if not exists idx_messages_pinned
  on public.messages(admin_id, is_pinned) where is_pinned;
create index if not exists idx_message_comments_message_status_created
  on public.message_comments(message_id, status, created_at asc);

create or replace function public.insert_anonymous_message(
  p_username text,
  p_message text,
  p_media_path text default null,
  p_media_type text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
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
  if nullif(btrim(p_message), '') is null and p_media_path is null then
    raise exception 'Message content is required';
  end if;
  if length(p_message) > 4000 then
    raise exception 'Message is too long';
  end if;
  if p_media_path is not null and split_part(p_media_path, '/', 1) <> p_username then
    raise exception 'Media path does not belong to this inbox';
  end if;

  insert into public.messages (admin_id, message, media_path, media_type, status, is_pinned)
  values (v_admin_id, p_message, p_media_path, p_media_type, 'pending', false)
  returning id into v_message_id;

  return v_message_id;
end;
$$;

create or replace function public.get_public_confessions()
returns table (
  id uuid,
  message text,
  media_path text,
  media_type text,
  created_at timestamptz,
  is_pinned boolean,
  comment_count bigint
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select m.id, m.message, m.media_path, m.media_type, m.created_at, m.is_pinned,
         count(c.id) filter (where c.status = 'approved') as comment_count
  from public.messages m
  left join public.message_comments c on c.message_id = m.id
  where m.status = 'approved'
  group by m.id
  order by m.is_pinned desc, m.created_at desc;
$$;

create or replace function public.get_public_profile(p_username text)
returns table (username text)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select p.username
  from public.profiles p
  where p.username = p_username;
$$;

create or replace function public.get_moderation_counts()
returns table (
  pending_messages bigint,
  approved_messages bigint,
  rejected_messages bigint,
  pending_comments bigint,
  pinned_messages bigint
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    count(*) filter (where m.status = 'pending'),
    count(*) filter (where m.status = 'approved'),
    count(*) filter (where m.status = 'rejected'),
    (select count(*) from public.message_comments c
      join public.messages parent on parent.id = c.message_id
      where parent.admin_id = auth.uid() and c.status = 'pending'),
    count(*) filter (where m.is_pinned)
  from public.messages m
  where m.admin_id = auth.uid();
$$;

drop function if exists public.get_public_comments(uuid);
create function public.get_public_comments(p_message_id uuid)
returns table (
  id uuid,
  message_id uuid,
  comment_text text,
  media_path text,
  media_type text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select c.id, c.message_id, c.comment_text, c.media_path, c.media_type, c.created_at
  from public.message_comments c
  join public.messages m on m.id = c.message_id
  where c.message_id = p_message_id
    and c.status = 'approved'
    and m.status = 'approved'
  order by c.created_at asc;
$$;

create or replace function public.submit_anonymous_comment(
  p_message_id uuid,
  p_comment_text text,
  p_media_path text default null,
  p_media_type text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_comment_id uuid;
begin
  if nullif(btrim(p_comment_text), '') is null and p_media_path is null then
    raise exception 'Response content is required';
  end if;
  if length(p_comment_text) > 4000 then
    raise exception 'Response is too long';
  end if;
  if not exists (
    select 1 from public.messages
    where id = p_message_id and status = 'approved'
  ) then
    raise exception 'Confession is not available for responses';
  end if;
  if p_media_path is not null and not exists (
    select 1
    from public.messages m
    join public.profiles p on p.id = m.admin_id
    where m.id = p_message_id
      and split_part(p_media_path, '/', 1) = p.username
  ) then
    raise exception 'Media path does not belong to this confession';
  end if;

  insert into public.message_comments (message_id, comment_text, media_path, media_type, status)
  values (p_message_id, p_comment_text, p_media_path, p_media_type, 'pending')
  returning id into v_comment_id;

  return v_comment_id;
end;
$$;

revoke all on function public.insert_anonymous_message(text, text, text, text) from public;
revoke all on function public.get_public_confessions() from public;
revoke all on function public.get_public_profile(text) from public;
revoke all on function public.get_moderation_counts() from public;
revoke all on function public.get_public_comments(uuid) from public;
revoke all on function public.submit_anonymous_comment(uuid, text, text, text) from public;
grant execute on function public.insert_anonymous_message(text, text, text, text) to anon, authenticated;
grant execute on function public.get_public_confessions() to anon, authenticated;
grant execute on function public.get_public_profile(text) to anon, authenticated;
grant execute on function public.get_moderation_counts() to authenticated;
grant execute on function public.get_public_comments(uuid) to anon, authenticated;
grant execute on function public.submit_anonymous_comment(uuid, text, text, text) to anon, authenticated;

insert into storage.buckets (id, name, public)
values ('message-media', 'message-media', false)
on conflict (id) do nothing;
update storage.buckets set public = false where id = 'message-media';

create or replace function public.is_public_message_media(p_name text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.messages m
    where m.media_path = p_name and m.status = 'approved'
  ) or exists (
    select 1
    from public.message_comments c
    join public.messages m on m.id = c.message_id
    where c.media_path = p_name and c.status = 'approved' and m.status = 'approved'
  );
$$;

create or replace function public.is_valid_message_media_folder(p_name text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.profiles p
    where p.username = split_part(p_name, '/', 1)
       or p.id::text = split_part(p_name, '/', 1)
  );
$$;

revoke all on function public.is_public_message_media(text) from public;
revoke all on function public.is_valid_message_media_folder(text) from public;
grant execute on function public.is_public_message_media(text) to anon, authenticated;
grant execute on function public.is_valid_message_media_folder(text) to anon, authenticated;

DO $drop_media_policies$
declare
  v_policy record;
begin
  for v_policy in
    select policyname
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and (
        coalesce(qual, '') ilike '%message-media%'
        or coalesce(with_check, '') ilike '%message-media%'
      )
  loop
    execute format('drop policy %I on storage.objects', v_policy.policyname);
  end loop;
end;
$drop_media_policies$;

drop policy if exists "Public can read approved message media" on storage.objects;
create policy "Public can read approved message media"
on storage.objects for select to anon, authenticated
using (bucket_id = 'message-media' and public.is_public_message_media(name));

drop policy if exists "Admins can read own message media" on storage.objects;
create policy "Admins can read own message media"
on storage.objects for select to authenticated
using (
  bucket_id = 'message-media'
  and (
    split_part(name, '/', 1) = auth.uid()::text
    or split_part(name, '/', 1) = (select p.username from public.profiles p where p.id = auth.uid())
  )
);

drop policy if exists "Visitors can upload message media" on storage.objects;
create policy "Visitors can upload message media"
on storage.objects for insert to anon, authenticated
with check (bucket_id = 'message-media' and public.is_valid_message_media_folder(name));

drop policy if exists "Admins can delete own message media" on storage.objects;
create policy "Admins can delete own message media"
on storage.objects for delete to authenticated
using (
  bucket_id = 'message-media'
  and (
    split_part(name, '/', 1) = auth.uid()::text
    or split_part(name, '/', 1) = (select p.username from public.profiles p where p.id = auth.uid())
  )
);

commit;
