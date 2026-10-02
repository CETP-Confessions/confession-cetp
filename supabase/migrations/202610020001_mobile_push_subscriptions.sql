create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null,
  subscription jsonb not null,
  created_at timestamptz not null default now(),
  unique (admin_id, endpoint)
);

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

drop policy if exists "Admins manage their own push subscriptions" on public.push_subscriptions;
create policy "Admins manage their own push subscriptions"
on public.push_subscriptions
for all to authenticated
using (auth.uid() = admin_id)
with check (auth.uid() = admin_id);

create extension if not exists pg_net with schema extensions;

create or replace function public.send_new_message_push()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  project_url text;
  webhook_secret text;
begin
  select decrypted_secret into project_url
  from vault.decrypted_secrets
  where name = 'supabase_project_url'
  limit 1;

  select decrypted_secret into webhook_secret
  from vault.decrypted_secrets
  where name = 'push_function_secret'
  limit 1;

  if project_url is null or webhook_secret is null then
    raise warning 'Push function URL or secret is missing from Vault.';
    return new;
  end if;

  perform net.http_post(
    url := rtrim(project_url, '/') || '/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', webhook_secret
    ),
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'messages',
      'record', jsonb_build_object('id', new.id, 'admin_id', new.admin_id)
    ),
    timeout_milliseconds := 5000
  );
  return new;
exception when others then
  raise warning 'Push notification request could not be queued: %', sqlerrm;
  return new;
end;
$$;

revoke all on function public.send_new_message_push() from public, anon, authenticated;

drop trigger if exists notify_admin_of_new_message on public.messages;
create trigger notify_admin_of_new_message
after insert on public.messages
for each row execute function public.send_new_message_push();