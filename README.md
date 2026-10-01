# CETP Confessions

CETP Confessions is a Vite app backed by Supabase Auth, PostgreSQL, and private Storage. Visitors submit anonymous messages and responses; an authenticated admin must approve each item before it becomes public.

## Local setup

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env.development.local` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
3. For the existing Supabase project, apply any unapplied migrations in timestamp order, including `202609290001_safe_public_content.sql` and `202609290002_scheduled_cleanup.sql`. Do not rerun the old base schema against an already initialized project.
4. For a brand-new Supabase project, run `supabase/schema.sql` first, then apply every migration in timestamp order. The migrations create the private `message-media` bucket, its policies, safe public RPCs, and scheduled cleanup.
5. Create the admin user in Supabase Auth, then link its auth UUID to a profile username in `public.profiles`. There is no public signup or registration flow.
6. Run `npm run dev` and open http://localhost:4173.

## Routes

- `/` home
- `/message/:username` anonymous message form
- `/public` approved confessions and approved anonymous comments
- `/admin/login` admin sign-in
- `/admin/dashboard` moderation inbox

Former `/admin/register` and `/register` URLs redirect to admin login; they do not create accounts.

## Moderation and security

- New messages and comments are inserted with `status = 'pending'` by security-definer RPCs; anonymous clients cannot write moderation fields.
- Public content comes from RPCs that return only approved messages and comments. Anonymous roles have no direct read access to either table.
- Admin RLS restricts message access to the admin's own inbox and comment access to comments attached to those messages. Moderation updates and deletes require an authenticated admin.
- Pinning is independent from approval and never publishes a pending/rejected item.
- Storage remains private. Anonymous uploads are limited to existing profile folders; signed media reads are allowed only for approved messages/comments. Admins can read their own inbox media.
- Neither messages nor comments contain sender identity columns.
- Only the Supabase anon key is used in the browser. Never expose a service-role key.
- Public RPCs return only the censored `public_message` field, and only approved, unexpired records. Admin approval requires a public version.
- Existing approved messages without a reliable approval time remain hidden until manually reviewed and re-approved; the migration does not guess their expiration date.
- Media references expire after seven days. The daily Edge Function deletes storage objects before clearing references and retries failed deletions.
- Admin passwords are sent directly to Supabase Auth through the `admin-login` Edge Function and are never stored by this app. Failed attempts are tracked using keyed hashes; three failures trigger a five-minute server-side lockout.
- An email alert is sent for the third failed attempt against the configured admin account when the Resend secrets below are configured.

## Admin login protection

Apply the login-protection migration and deploy the Edge Function:

```sh
supabase db push
supabase functions deploy admin-login
```

Set these values as Supabase Edge Function secrets, not in `.env` or source control: `ADMIN_LOGIN_ALERT_EMAIL`, `RESEND_API_KEY`, and `RESEND_FROM_EMAIL`. Use a verified sender address for Resend. Supabase supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` to the function runtime. Without the Resend secrets, server-side lockout still works but email alerts are disabled.

## Scheduled cleanup setup

Deploy `cleanup-expired-media` manually after applying the migrations. Set the Edge Function secret using `supabase secrets set CLEANUP_FUNCTION_SECRET=<random-secret>`; Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to the function runtime. Before applying `202609290002_scheduled_cleanup.sql`, add matching values to Supabase Vault:

```sql
select vault.create_secret('https://YOUR_PROJECT_REF.supabase.co', 'supabase_project_url');
select vault.create_secret('THE_SAME_RANDOM_SECRET', 'cleanup_function_secret');
```

The migration schedules the function daily at 03:15 UTC using Supabase Cron. Deployment is not performed by the app or these instructions.

## Validation

Run `npm run build`. The production workflow also requires applying all migrations and configuring/deploying the cleanup function in the target Supabase project before testing submissions, moderation, or retention.
