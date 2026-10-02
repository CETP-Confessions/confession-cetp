begin;

drop policy if exists "Admins can read own profile" on public.profiles;
create policy "Admins can read own profile"
on public.profiles for select to authenticated
using (auth.uid() = id and auth.jwt() ->> 'aal' = 'aal2');

drop policy if exists "Admins can read own messages" on public.messages;
create policy "Admins can read own messages"
on public.messages for select to authenticated
using (auth.uid() = admin_id and auth.jwt() ->> 'aal' = 'aal2');

drop policy if exists "Admins can moderate own messages" on public.messages;
create policy "Admins can moderate own messages"
on public.messages for update to authenticated
using (auth.uid() = admin_id and auth.jwt() ->> 'aal' = 'aal2')
with check (auth.uid() = admin_id and auth.jwt() ->> 'aal' = 'aal2');

drop policy if exists "Admins can delete own messages" on public.messages;
create policy "Admins can delete own messages"
on public.messages for delete to authenticated
using (auth.uid() = admin_id and auth.jwt() ->> 'aal' = 'aal2');

drop policy if exists "Admins can read own comments" on public.message_comments;
create policy "Admins can read own comments"
on public.message_comments for select to authenticated
using (
  auth.jwt() ->> 'aal' = 'aal2'
  and exists (
    select 1 from public.messages m
    where m.id = message_comments.message_id and m.admin_id = auth.uid()
  )
);

drop policy if exists "Admins can moderate own comments" on public.message_comments;
create policy "Admins can moderate own comments"
on public.message_comments for update to authenticated
using (
  auth.jwt() ->> 'aal' = 'aal2'
  and exists (
    select 1 from public.messages m
    where m.id = message_comments.message_id and m.admin_id = auth.uid()
  )
)
with check (
  auth.jwt() ->> 'aal' = 'aal2'
  and exists (
    select 1 from public.messages m
    where m.id = message_comments.message_id and m.admin_id = auth.uid()
  )
);

drop policy if exists "Admins can delete own comments" on public.message_comments;
create policy "Admins can delete own comments"
on public.message_comments for delete to authenticated
using (
  auth.jwt() ->> 'aal' = 'aal2'
  and exists (
    select 1 from public.messages m
    where m.id = message_comments.message_id and m.admin_id = auth.uid()
  )
);

drop policy if exists "Admins can read own message media" on storage.objects;
create policy "Admins can read own message media"
on storage.objects for select to authenticated
using (
  bucket_id = 'message-media'
  and auth.jwt() ->> 'aal' = 'aal2'
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
  and auth.jwt() ->> 'aal' = 'aal2'
  and (
    split_part(name, '/', 1) = auth.uid()::text
    or split_part(name, '/', 1) = (select p.username from public.profiles p where p.id = auth.uid())
    or exists (
      select 1 from public.messages m
      where m.id::text = split_part(name, '/', 1) and m.admin_id = auth.uid()
    )
  )
);

drop policy if exists "Admins manage their own push subscriptions" on public.push_subscriptions;
create policy "Admins manage their own push subscriptions"
on public.push_subscriptions for all to authenticated
using (auth.uid() = admin_id and auth.jwt() ->> 'aal' = 'aal2')
with check (auth.uid() = admin_id and auth.jwt() ->> 'aal' = 'aal2');

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
      where parent.admin_id = auth.uid() and c.status = 'pending'
        and auth.jwt() ->> 'aal' = 'aal2'),
    count(*) filter (where m.is_pinned)
  from public.messages m
  where m.admin_id = auth.uid() and auth.jwt() ->> 'aal' = 'aal2';
$$;

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
    and auth.jwt() ->> 'aal' = 'aal2'
    and (p_message_ids is null or c.message_id = any(p_message_ids))
  order by c.created_at desc;
$$;

commit;