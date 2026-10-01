begin;

-- Create the cleanup function
create or replace function public.cleanup_expired_approved_messages()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_expired_record record;
begin
  -- Loop through all expired messages
  for v_expired_record in 
    select id, media_path 
    from public.messages 
    where status = 'approved' 
      and approved_expires_at <= now()
  loop
    -- Delete associated media from Supabase Storage (for the message itself)
    if v_expired_record.media_path is not null then
      -- Note: using the pg_net extension or direct storage function if available.
      -- Supabase recommends calling storage API from Edge Functions, but if we do this in SQL
      -- we rely on a separate edge function or just do it via HTTP if pg_net is enabled.
      -- Since the user asked for an "Edge Function" in the prompt, this SQL function is 
      -- optional and just for the DB side. Let's rely on the Edge Function for storage.
      null;
    end if;
  end loop;
end;
$$;

commit;
