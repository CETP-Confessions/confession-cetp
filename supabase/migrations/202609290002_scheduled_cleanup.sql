begin;

update storage.buckets
set allowed_mime_types = array[
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'video/mp4', 'video/webm'
]
where id = 'message-media';

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

DO $$
begin
  if exists (select 1 from cron.job where jobname = 'cleanup-expired-media-daily') then
    perform cron.unschedule('cleanup-expired-media-daily');
  end if;
end;
$$;

select cron.schedule(
  'cleanup-expired-media-daily',
  '15 3 * * *',
  $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'supabase_project_url')
        || '/functions/v1/cleanup-expired-media',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret from vault.decrypted_secrets where name = 'cleanup_function_secret'
        )
      ),
      body := '{}'::jsonb
    );
  $job$
);

commit;
