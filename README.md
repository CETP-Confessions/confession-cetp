# Quietdrop

Quietdrop is a simple anonymous messaging app built with Vite and Supabase. It keeps the public submission flow anonymous while the admin uses Supabase Auth and a private inbox dashboard.

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Create your frontend environment file:

```bash
copy .env.example .env.development.local
```

Fill in:

```dotenv
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

3. Create the Supabase project schema:

- Open the Supabase SQL editor.
- Run the SQL in `supabase/schema.sql`.
- Create a private storage bucket named `message-media` in the Supabase dashboard.

4. Start the app:

```bash
npm run dev
```

Open http://localhost:5173.

## Routes

- `/`
- `/message/:username`
- `/admin/login`
- `/admin/register`
- `/admin/dashboard`

## Production build

```bash
npm run build
```

## Supabase setup notes

- The app uses only the anon key in the browser.
- Service-role secrets stay server-side only and are not committed in the frontend.
- The public message form submits to a valid profile by username and stores the message against the correct admin id.
- The storage bucket is private, and media previews use signed URLs.

## Security

- Row Level Security protects the `profiles` and `messages` tables.
- Anonymous visitors can submit only to valid usernames.
- Admin users can view and manage only their own messages.
- No sender identity is stored in `messages`.
