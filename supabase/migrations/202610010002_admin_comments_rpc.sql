begin;

create or replace function public.get_admin_comments(p_message_ids uuid[] default null)
returns table (
  id uuid,
  message_id uuid,
  comment_text text,
  media_path text,
  media_type text,
  created_at timestamptz,
  status text,
  media_expires_at timestamptz,
  public_comment text
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select c.id,
         c.message_id,
         c.comment_text,
         c.media_path,
         c.media_type,
         c.created_at,
         c.status,
         c.media_expires_at,
         c.public_comment
  from public.message_comments c
  join public.messages m on m.id = c.message_id
  where m.admin_id = auth.uid()
    and (p_message_ids is null or c.message_id = any(p_message_ids))
  order by c.created_at desc;
$$;

revoke all on function public.get_admin_comments(uuid[]) from public, anon, authenticated;
grant execute on function public.get_admin_comments(uuid[]) to authenticated;

commit;
