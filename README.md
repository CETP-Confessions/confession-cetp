# CETP Confessions

CETP Confessions is a Vite app backed by Supabase Auth, PostgreSQL, and private Storage. Visitors submit anonymous messages and responses; an authenticated admin must approve each item before it becomes public.

## Local setup

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env.development.local` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
3. For the existing Supabase project, open the SQL Editor and run `supabase/migrations/202609270001_public_confessions_moderation.sql`. Do not rerun the old base schema against an already initialized project.
4. For a brand-new Supabase project, run `supabase/schema.sql` first, then the migration above. The migration creates the private `message-media` bucket and its policies.
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

## Validation

Run `npm run build`. The production workflow also requires applying the migration to the target Supabase project before testing submissions or moderation.
