begin;

create table if not exists public.admin_login_attempts (
  email_hash text primary key,
  ip_hash text not null,
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  window_started_at timestamptz not null default now(),
  locked_until timestamptz,
  alert_sent_at timestamptz
);

alter table public.admin_login_attempts enable row level security;
revoke all on table public.admin_login_attempts from public, anon, authenticated;
grant all on table public.admin_login_attempts to service_role;

create or replace function public.check_admin_login_lockout(p_email_hash text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_attempts integer;
  v_window_started_at timestamptz;
  v_locked_until timestamptz;
begin
  select failed_attempts, window_started_at, locked_until
    into v_attempts, v_window_started_at, v_locked_until
  from public.admin_login_attempts
  where email_hash = p_email_hash
  for update;

  if not found then
    return jsonb_build_object('locked', false, 'attempts', 0, 'retryAfterSeconds', 0);
  end if;

  if v_window_started_at <= now() - interval '15 minutes' then
    update public.admin_login_attempts
    set failed_attempts = 0,
        window_started_at = now(),
        locked_until = null,
        alert_sent_at = null
    where email_hash = p_email_hash;
    return jsonb_build_object('locked', false, 'attempts', 0, 'retryAfterSeconds', 0);
  end if;

  if v_locked_until is not null and v_locked_until > now() then
    return jsonb_build_object(
      'locked', true,
      'attempts', v_attempts,
      'retryAfterSeconds', greatest(1, ceil(extract(epoch from (v_locked_until - now())))::integer)
    );
  end if;

  return jsonb_build_object('locked', false, 'attempts', v_attempts, 'retryAfterSeconds', 0);
end;
$$;

create or replace function public.record_admin_login_failure(p_email_hash text, p_ip_hash text, p_alert_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_attempts integer;
  v_window_started_at timestamptz;
  v_locked_until timestamptz;
  v_alert_sent_at timestamptz;
  v_should_notify boolean := false;
begin
  insert into public.admin_login_attempts (email_hash, ip_hash, failed_attempts, window_started_at)
  values (p_email_hash, p_ip_hash, 1, now())
  on conflict (email_hash) do update
  set ip_hash = excluded.ip_hash,
      failed_attempts = case
        when public.admin_login_attempts.window_started_at <= now() - interval '15 minutes' then 1
        else public.admin_login_attempts.failed_attempts + 1
      end,
      window_started_at = case
        when public.admin_login_attempts.window_started_at <= now() - interval '15 minutes' then now()
        else public.admin_login_attempts.window_started_at
      end,
      locked_until = case
        when public.admin_login_attempts.window_started_at <= now() - interval '15 minutes' then null
        when public.admin_login_attempts.failed_attempts + 1 >= 3 then now() + interval '5 minutes'
        else public.admin_login_attempts.locked_until
      end,
      alert_sent_at = case
        when public.admin_login_attempts.window_started_at <= now() - interval '15 minutes' then null
        else public.admin_login_attempts.alert_sent_at
      end
  returning failed_attempts, window_started_at, locked_until, alert_sent_at
    into v_attempts, v_window_started_at, v_locked_until, v_alert_sent_at;

  if p_alert_enabled and v_attempts >= 3 and v_alert_sent_at is null then
    update public.admin_login_attempts
    set alert_sent_at = now()
    where email_hash = p_email_hash and alert_sent_at is null;
    v_should_notify := found;
    v_alert_sent_at := case when v_should_notify then now() else v_alert_sent_at end;
  end if;

  return jsonb_build_object(
    'locked', v_locked_until is not null and v_locked_until > now(),
    'attempts', v_attempts,
    'retryAfterSeconds', case
      when v_locked_until is not null and v_locked_until > now()
        then greatest(1, ceil(extract(epoch from (v_locked_until - now())))::integer)
      else 0
    end,
    'shouldNotify', v_should_notify
  );
end;
$$;

create or replace function public.clear_admin_login_failures(p_email_hash text)
returns void
language sql
security definer
set search_path = pg_catalog, public
as $$
  delete from public.admin_login_attempts where email_hash = p_email_hash;
$$;

revoke all on function public.check_admin_login_lockout(text) from public, anon, authenticated;
revoke all on function public.record_admin_login_failure(text, text, boolean) from public, anon, authenticated;
revoke all on function public.clear_admin_login_failures(text) from public, anon, authenticated;
grant execute on function public.check_admin_login_lockout(text) to service_role;
grant execute on function public.record_admin_login_failure(text, text, boolean) to service_role;
grant execute on function public.clear_admin_login_failures(text) to service_role;

commit;
