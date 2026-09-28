begin;

-- 1. Configure Storage Bucket for File Types & Size Limits
-- We update the 'message-media' bucket to only allow images and limit size to 5MB (5242880 bytes).
update storage.buckets
set allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
    file_size_limit = 5242880
where id = 'message-media';

-- 2. Server-side Rate Limiting for Anonymous Submissions
create table if not exists public.submission_logs (
  id uuid primary key default gen_random_uuid(),
  ip_address text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_submission_logs_ip on public.submission_logs(ip_address, created_at desc);

-- Allow system to clean up old logs automatically
create or replace function public.cleanup_submission_logs()
returns void language sql security definer as $$
  delete from public.submission_logs where created_at < now() - interval '1 hour';
$$;

create or replace function public.check_rate_limit(p_ip text)
returns void language plpgsql security definer as $$
declare
  recent_count integer;
begin
  if p_ip is null or p_ip = '' then
    return;
  end if;

  select count(*) into recent_count
  from public.submission_logs
  where ip_address = p_ip
    and created_at > now() - interval '15 seconds';

  if recent_count > 0 then
    raise exception 'Rate limit exceeded. Please wait 15 seconds before submitting again.';
  end if;

  insert into public.submission_logs (ip_address) values (p_ip);
end;
$$;

-- Update the insert_anonymous_message RPC to include rate limiting
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
  v_client_ip text;
begin
  -- Extract IP from request headers (Supabase specific)
  begin
    v_client_ip := coalesce(
      current_setting('request.headers', true)::json->>'x-real-ip',
      split_part(current_setting('request.headers', true)::json->>'x-forwarded-for', ',', 1)
    );
  exception when others then
    v_client_ip := 'unknown';
  end;

  -- Apply rate limit
  perform public.check_rate_limit(v_client_ip);

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

-- Update submit_anonymous_comment to include rate limiting
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
  v_client_ip text;
begin
  -- Extract IP from request headers (Supabase specific)
  begin
    v_client_ip := coalesce(
      current_setting('request.headers', true)::json->>'x-real-ip',
      split_part(current_setting('request.headers', true)::json->>'x-forwarded-for', ',', 1)
    );
  exception when others then
    v_client_ip := 'unknown';
  end;

  -- Apply rate limit
  perform public.check_rate_limit(v_client_ip);

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
revoke all on function public.submit_anonymous_comment(uuid, text, text, text) from public;
grant execute on function public.insert_anonymous_message(text, text, text, text) to anon, authenticated;
grant execute on function public.submit_anonymous_comment(uuid, text, text, text) to anon, authenticated;

commit;
