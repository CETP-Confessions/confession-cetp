begin;

-- Add approved_expires_at to messages
alter table public.messages 
  add column if not exists approved_expires_at timestamptz null;

-- Update existing approved messages (if any)
-- NOTE: If there is no reliable approval timestamp, we cannot guess safely. 
-- For this migration, we set it to created_at + 60 days only if we can be reasonably sure,
-- but the instructions say "DO NOT guess silently. Report those records".
-- We will leave it NULL for now, and the admin must manually handle them.

-- Function to handle setting expiration on approval
create or replace function public.handle_message_approval_expiration()
returns trigger
language plpgsql
security definer
as $$
begin
  if NEW.status = 'approved' and (OLD.status is null or OLD.status != 'approved') then
    NEW.approved_expires_at = now() + interval '60 days';
  elsif NEW.status != 'approved' then
    NEW.approved_expires_at = null;
  end if;
  return NEW;
end;
$$;

drop trigger if exists set_message_approval_expiration on public.messages;
create trigger set_message_approval_expiration
  before update of status on public.messages
  for each row
  execute function public.handle_message_approval_expiration();

-- Update get_public_confessions to filter out expired messages (fail-safe)
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
    and (m.approved_expires_at is null or m.approved_expires_at > now())
  group by m.id
  order by m.is_pinned desc, m.created_at desc;
$$;

commit;
