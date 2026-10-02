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
- Admin passwords are sent to Supabase Auth through the same-origin Vercel API route at `/api/admin-login` and are never stored by this app. Failed attempts are tracked using keyed hashes; three failures trigger a five-minute server-side lockout.
- Admin dashboard data, storage, and push subscriptions require Supabase assurance level `aal2`. Admins enroll an authenticator app at sign-in, then confirm a six-digit code.
- An email alert is sent for the third failed attempt against the configured admin account when the Vercel Resend environment variables are configured.

## Mobile push notifications

Push notifications require HTTPS. On iPhone or iPad, install the site from Safari using **Share > Add to Home Screen**, then open the installed app before enabling notifications. Android users can enable notifications in a supported browser.

1. Generate one VAPID key pair with `npx --yes web-push generate-vapid-keys`. Keep the private key secret; do not commit it.
2. Add the generated public key as `VITE_WEB_PUSH_PUBLIC_KEY` in the local Vite environment and in the production host's environment variables, then redeploy the frontend.
3. Set the function secrets and deploy the function:

```sh
supabase secrets set VAPID_PUBLIC_KEY=<public-key> VAPID_PRIVATE_KEY=<private-key> VAPID_SUBJECT=mailto:admin@example.com PUSH_WEBHOOK_SECRET=<random-secret>
supabase functions deploy send-push --use-api
```

4. Apply the migration with `supabase db push`. Then add the same random webhook secret to Vault:

```sql
select vault.create_secret('THE_SAME_RANDOM_SECRET', 'push_function_secret');
```

The project URL is read from the existing `supabase_project_url` Vault secret. The migration creates a `pg_net` trigger that posts only the message ID and admin ID to the function; it does not include message content.
5. Use the exact same public key in the frontend and Edge Function. Generate a long random webhook secret, for example with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
6. Sign in to the admin dashboard on each device and press **Enable mobile alerts** or **Set up mobile alerts**. Allow the browser permission prompt.

The database webhook sends generic notification text and never includes the anonymous message content. The Edge Function removes expired device subscriptions automatically. If notification permission was previously denied, re-enable it in the browser or device settings first.

## Admin login protection

Apply all database migrations, including the admin login protection and MFA enforcement migrations:

```sh
supabase db push
```

Set these Vercel environment variables on the server runtime: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_LOGIN_ALERT_EMAIL`, `RESEND_API_KEY`, and `RESEND_FROM_EMAIL`. Use a verified sender address for Resend. Never use a `VITE_` prefix for the service-role key or Resend key. Without the Resend variables, server-side lockout still works but email alerts are disabled.

In Supabase Auth URL Configuration, allow the recovery redirect for your deployed site (for example `https://YOUR_DOMAIN/admin/login*`) and local development (`http://localhost:5173/admin/login*`). The password reset email returns to the app to set the new password.

Password recovery also requires a working email provider. Configure custom SMTP in Supabase Authentication settings with a verified sender; Supabase's default mail service is restricted and may not deliver recovery messages to arbitrary addresses.

## Scheduled cleanup setup

Deploy `cleanup-expired-media` manually after applying the migrations. Set the Edge Function secret using `supabase secrets set CLEANUP_FUNCTION_SECRET=<random-secret>`; Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to the function runtime. Before applying `202609290002_scheduled_cleanup.sql`, add matching values to Supabase Vault:

```sql
select vault.create_secret('https://YOUR_PROJECT_REF.supabase.co', 'supabase_project_url');
select vault.create_secret('THE_SAME_RANDOM_SECRET', 'cleanup_function_secret');
```

The migration schedules the function daily at 03:15 UTC using Supabase Cron. Deployment is not performed by the app or these instructions.

## Validation

Run `npm run build`. The production workflow also requires applying all migrations and configuring/deploying the cleanup function in the target Supabase project before testing submissions, moderation, or retention.
