begin;

alter table public.messages
  add column if not exists public_message text,
  add column if not exists public_edited_at timestamptz,
  add column if not exists public_edited_by uuid references auth.users(id) on delete set null,
  add column if not exists media_expires_at timestamptz;

alter table public.message_comments
  add column if not exists media_expires_at timestamptz,
  add column if not exists public_comment text;

update public.messages
set media_expires_at = created_at + interval '7 days'
where media_path is not null and media_expires_at is null;

update public.message_comments
set media_expires_at = created_at + interval '7 days'
where media_path is not null and media_expires_at is null;

create index if not exists idx_messages_approved_expiration
  on public.messages(approved_expires_at)
  where status = 'approved';
create index if not exists idx_messages_media_expiration
  on public.messages(media_expires_at)
  where media_path is not null;
create index if not exists idx_comments_media_expiration
  on public.message_comments(media_expires_at)
  where media_path is not null;

-- Public RPCs return a deliberately small allowlist. Never return the private message column.
drop function if exists public.get_public_confessions();
drop function if exists public.get_public_comments(uuid);
create function public.get_public_confessions(p_limit integer default 20, p_offset integer default 0)
returns table (
  id uuid,
  public_message text,
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
  select m.id,
         case when length(m.public_message) > 280 then left(m.public_message, 280) || '...' else m.public_message end,
      case when m.media_expires_at > now() then m.media_path else null end,
      m.media_type, m.created_at, m.is_pinned,
         count(c.id) filter (where c.status = 'approved') as comment_count
  from public.messages m
  left join public.message_comments c on c.message_id = m.id
  where m.status = 'approved'
    and m.approved_expires_at > now()
    and nullif(btrim(m.public_message), '') is not null
  group by m.id
  order by m.is_pinned desc, m.created_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function public.get_public_message(p_message_id uuid)
returns table (
  id uuid,
  public_message text,
  media_path text,
  media_type text,
  media_expired boolean,
  created_at timestamptz,
  is_pinned boolean,
  comment_count bigint
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select m.id, m.public_message,
         case when m.media_expires_at > now() then m.media_path else null end,
         m.media_type,
         (m.media_path is not null and m.media_expires_at <= now()),
         m.created_at, m.is_pinned,
         (select count(*) from public.message_comments c
           where c.message_id = m.id and c.status = 'approved')
  from public.messages m
  where m.id = p_message_id
    and m.status = 'approved'
    and m.approved_expires_at > now()
    and nullif(btrim(m.public_message), '') is not null;
$$;

create or replace function public.get_public_comments(p_message_id uuid)
returns table (
  id uuid,
  message_id uuid,
  comment_text text,
  media_path text,
  media_type text,
  media_expired boolean,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select c.id, c.message_id, coalesce(c.public_comment, c.comment_text),
         case when c.media_expires_at > now() then c.media_path else null end,
         c.media_type,
         (c.media_path is not null and c.media_expires_at <= now()),
         c.created_at
  from public.message_comments c
  join public.messages m on m.id = c.message_id
  where c.message_id = p_message_id
    and c.status = 'approved'
    and m.status = 'approved'
    and m.approved_expires_at > now()
  order by c.created_at asc;
$$;

alter table public.message_comments
  add column if not exists public_comment text;

create or replace function public.handle_message_approval_expiration()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    new.approved_expires_at := now() + interval '60 days';
    if new.public_message is null then
      raise exception 'Set the public version before approving this message';
    end if;
  elsif new.status <> 'approved' then
    new.approved_expires_at := null;
  end if;
  return new;
end;
$$;

create or replace function public.handle_comment_public_version()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved'
      and new.public_comment is null then
    new.public_comment := new.comment_text;
  end if;
  return new;
end;
$$;

drop trigger if exists set_comment_public_version on public.message_comments;
create trigger set_comment_public_version
  before update of status on public.message_comments
  for each row execute function public.handle_comment_public_version();

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
  select id into v_admin_id from public.profiles where username = p_username;
  if v_admin_id is null then raise exception 'Profile not found'; end if;
  if nullif(btrim(p_message), '') is null and p_media_path is null then
    raise exception 'Message content is required';
  end if;
  if length(p_message) > 4000 then raise exception 'Message is too long'; end if;
  if p_media_path is not null and split_part(p_media_path, '/', 1) <> p_username then
    raise exception 'Media path does not belong to this inbox';
  end if;

  insert into public.messages (admin_id, message, media_path, media_type, media_expires_at)
  values (v_admin_id, p_message, p_media_path, p_media_type,
          case when p_media_path is null then null else now() + interval '7 days' end)
  returning id into v_message_id;
  return v_message_id;
end;
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
  if length(p_comment_text) > 4000 then raise exception 'Response is too long'; end if;
  if not exists (select 1 from public.messages
      where id = p_message_id and status = 'approved' and approved_expires_at > now()) then
    raise exception 'Confession is not available for responses';
  end if;
  if p_media_path is not null and split_part(p_media_path, '/', 1) <> p_message_id::text then
    raise exception 'Media path does not belong to this confession';
  end if;

  insert into public.message_comments (message_id, comment_text, media_path, media_type, media_expires_at)
  values (p_message_id, p_comment_text, p_media_path, p_media_type,
          case when p_media_path is null then null else now() + interval '7 days' end)
  returning id into v_comment_id;
  return v_comment_id;
end;
$$;

-- Replace the older trigger function behavior without changing independent pin updates.
drop trigger if exists set_message_approval_expiration on public.messages;
create trigger set_message_approval_expiration
  before update of status on public.messages
  for each row execute function public.handle_message_approval_expiration();

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
      and m.approved_expires_at > now() and m.media_expires_at > now()
  ) or exists (
    select 1 from public.message_comments c
    join public.messages m on m.id = c.message_id
    where c.media_path = p_name and c.status = 'approved'
      and m.status = 'approved' and m.approved_expires_at > now()
      and c.media_expires_at > now()
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
    select 1 from public.profiles p where p.username = split_part(p_name, '/', 1)
  ) or exists (
    select 1 from public.messages m
    where m.id::text = split_part(p_name, '/', 1)
      and m.status = 'approved' and m.approved_expires_at > now()
  );
$$;

drop policy if exists "Admins can read own message media" on storage.objects;
create policy "Admins can read own message media"
on storage.objects for select to authenticated
using (
  bucket_id = 'message-media'
  and (
    split_part(name, '/', 1) = auth.uid()::text
    or split_part(name, '/', 1) = (select p.username from public.profiles p where p.id = auth.uid())
    or exists (
      select 1 from public.messages m
      where m.id::text = split_part(name, '/', 1) and m.admin_id = auth.uid()
    )
  )
);

drop policy if exists "Admins can delete own message media" on storage.objects;
create policy "Admins can delete own message media"
on storage.objects for delete to authenticated
using (
  bucket_id = 'message-media'
  and (
    split_part(name, '/', 1) = auth.uid()::text
    or split_part(name, '/', 1) = (select p.username from public.profiles p where p.id = auth.uid())
    or exists (
      select 1 from public.messages m
      where m.id::text = split_part(name, '/', 1) and m.admin_id = auth.uid()
    )
  )
);

-- The former rate limiter persisted raw client IP addresses. Do not retain sender identifiers.
drop function if exists public.check_rate_limit(text);
drop function if exists public.cleanup_submission_logs();
drop table if exists public.submission_logs;

revoke all on function public.get_public_confessions(integer, integer) from public;
revoke all on function public.get_public_message(uuid) from public;
revoke all on function public.get_public_comments(uuid) from public;
revoke all on function public.insert_anonymous_message(text, text, text, text) from public;
revoke all on function public.submit_anonymous_comment(uuid, text, text, text) from public;
grant execute on function public.get_public_confessions(integer, integer) to anon, authenticated;
grant execute on function public.get_public_message(uuid) to anon, authenticated;
grant execute on function public.get_public_comments(uuid) to anon, authenticated;
grant execute on function public.insert_anonymous_message(text, text, text, text) to anon, authenticated;
grant execute on function public.submit_anonymous_comment(uuid, text, text, text) to anon, authenticated;

revoke update on public.messages from authenticated;
grant update (status, is_pinned, is_read, public_message, public_edited_at, public_edited_by)
  on public.messages to authenticated;
revoke update on public.message_comments from authenticated;
grant update (status, public_comment) on public.message_comments to authenticated;

commit;
