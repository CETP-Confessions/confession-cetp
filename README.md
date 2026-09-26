# Quietdrop

Quietdrop is a Vercel-hosted anonymous inbox backed by Firebase. Recipients create an account and a private destination link; visitors can submit text and optional images, GIFs, or short video without registering. Firebase Anonymous Authentication is used as a short-lived upload credential, but its UID is not written to the message or exposed to the recipient. The recipient-facing wording is: **Your identity isn't shown to the recipient.**

## Included

- Email/password account registration and sign-in, individual destination links, owner-only inbox, status filtering, media previews, and moderation actions.
- Callable Functions for destination creation, anonymous upload reservations and message submission, rule-based moderation, reports, deletion, notifications, and abandoned-upload cleanup.
- Private Storage paths guarded by upload reservations, MIME/size rules, server-side content-signature checks, and owner-only reads.
- Firestore and Storage rules, App Check enforcement for callable Functions, rate limits, Firestore indexes, Vercel SPA rewrites, and Auth/Firestore/Storage/Functions emulators.
- Rules tests that verify inbox isolation, public destination access, and denial of client message writes.

The personal inbox flow is implemented end to end once the existing Firebase project is configured. Organization/department administration, anonymous reply conversations, QR generation, and client-side FCM token enrollment are not implemented yet. FCM delivery is wired for accounts that have registered tokens. These are not simulated UI features.

## Prerequisites

- Node.js 22 or later and npm.
- Firebase CLI: `npm install --global firebase-tools`.
- Access to the existing Firebase project `confession-cetp`. Cloud Functions deployment requires a billing-enabled project. The Emulator Suite uses this project ID locally while routing service requests to local emulator processes.

## Install

```powershell
npm install
npm --prefix functions install
Copy-Item .env.example .env.development.local
```

For local development, set `VITE_USE_EMULATORS=true` in `.env.development.local` and use the Firebase emulators so local tests do not change production data. Before production use, configure the required Firebase services and set the reCAPTCHA Enterprise site key in Vercel. Create/update `functions/.env.confession-cetp` with a randomly generated `RATE_LIMIT_SALT` before deploying Functions.

```dotenv
VITE_FIREBASE_API_KEY=the-existing-web-app-api-key
VITE_FIREBASE_AUTH_DOMAIN=confession-cetp.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=confession-cetp
VITE_FIREBASE_STORAGE_BUCKET=confession-cetp.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=77355569643
VITE_FIREBASE_APP_ID=the-existing-web-app-id
VITE_FIREBASE_MEASUREMENT_ID=the-existing-measurement-id
VITE_RECAPTCHA_ENTERPRISE_SITE_KEY=
VITE_USE_EMULATORS=true
VITE_MAX_IMAGE_MB=10
VITE_MAX_VIDEO_MB=50
```

Run the app locally with the Firebase emulators:

```powershell
npm run emulators
```

In a second terminal:

```powershell
npm run dev
```

Open the Vite URL printed by the dev server. Confirm `VITE_USE_EMULATORS=true` before testing sign-up, messages, or uploads. To deliberately use the production Firebase project locally, set it to `false` and understand that all writes affect production data.

## Rules Tests

```powershell
npm run test:rules
```

This starts the Firestore and Storage Emulators, runs the rules tests, and shuts the emulators down. For local Functions work, run `npm run emulators` separately. The Storage rules rely on Firestore cross-service rule lookups; enable cross-service permissions when Firebase prompts during project setup.

## Firebase Project Setup

1. Sign in to the Firebase CLI with an account that already has access to `confession-cetp`, then verify access:

```powershell
firebase login
firebase projects:list
firebase use confession-cetp
firebase use
```

The active project must show `confession-cetp`. This repository is already configured for that project; do not create another Firebase project.
2. In the existing Firebase Console project, enable Authentication with Email/Password and Anonymous providers; create/use its Firestore database and Storage bucket. Keep Web app settings in ignored local environment files or Vercel project settings, never source files.
3. Configure App Check for the existing Web app with reCAPTCHA Enterprise. Add every deployed domain to that provider and set its site key as `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY` in `.env.production.local`. The supplied measurement ID is not an App Check key. Production callable Functions enforce App Check; only the Functions emulator skips that requirement.
4. These Firebase Web settings are public client configuration, not server credentials. Never put Admin SDK keys in frontend files. `firebase init` is unnecessary because this repository already has Hosting, rules, indexes, Functions, and emulator configuration.
5. Configure `functions/.env.confession-cetp` with a random `RATE_LIMIT_SALT`. Optional settings are `MAX_MESSAGES_PER_IP_PER_MINUTE` (default 8), `MAX_MESSAGES_PER_DESTINATION_PER_MINUTE` (default 5), `MAX_ATTACHMENTS_PER_MESSAGE` (default 3), `MAX_IMAGE_MB` (default 10), and `MAX_VIDEO_MB` (default 50). Keep this file out of source control. Storage rules enforce hard ceilings of 10 MB for images/GIFs and 50 MB for video.
6. Deploy security rules, indexes, Storage rules, and Functions from the repository:

```powershell
firebase deploy --only firestore:rules,firestore:indexes,storage
firebase deploy --only functions
```

Firebase Hosting is not the production frontend host. Vercel serves the web application; Firebase hosts the backend services.

## Data and Security Notes

Destination documents contain owner/admin fields but cannot be read directly by clients; a callable returns an allowlisted display projection for public links. Message documents contain destination ID, text, safe Storage paths, category, status, timestamps, and a report marker; they contain no sender UID, IP address, or moderation reasons. Moderation signals, anonymous upload reservations, hashed rate-limit keys, and message fingerprints live in server-only collections denied by Firestore rules. Successful anonymous Auth identities are deleted after submission. Uploaded objects are readable only by the destination owner after a completed reservation. Download tokens are not stored in message documents.

All message and moderation writes go through callable Functions. Firestore client writes to messages are denied. App Check reduces unauthorized use but is not a replacement for Authentication, authorization, validation, or Security Rules. The current word/link/PII/repetition checks are heuristic flags for human review; they are not a promise that harmful content will be detected or that senders cannot be investigated for abuse or legal compliance.

## Build

```powershell
npm run build
npm run preview
```

Set a valid App Check Enterprise site key in Vercel before deploying the production frontend. `.firebaserc` defaults to `confession-cetp`; the Firebase CLI must be logged into an account authorized for that existing project before backend deployment.

## Vercel Deployment

1. Push the repository to GitHub and import it in Vercel.
2. Use the repository root as the project root, `npm run build` as the build command, and `dist` as the output directory. `vercel.json` rewrites application routes such as `/u/shahin` to the Vite entry point.
3. Add these Production (and Preview, if desired) environment variables in Vercel. Use values from the same Web App under Firebase Console → Project settings → Your apps:

```text
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
VITE_FIREBASE_MEASUREMENT_ID
VITE_RECAPTCHA_ENTERPRISE_SITE_KEY
VITE_USE_EMULATORS=false
```

The project brief contains conflicting `appId` and `measurementId` values in its two configuration examples. Confirm the values in the existing `confession-cetp` Web App settings and use that single configuration consistently; the measurement ID is optional for core messaging.
4. Deploy from Vercel and add the production domain to Firebase Authentication authorized domains and the Firebase App Check reCAPTCHA Enterprise configuration. Add Preview domains only if Preview deployments should access Firebase.
5. Verify registration provisions `/u/{username}`, a signed-out visitor can submit a note, and the owner can read it. Confirm Firestore, Storage, and Functions are the existing `confession-cetp` services.

Subsequent pushes to the connected GitHub branch trigger Vercel builds and deployments. Deploy Firebase rules and Functions separately with the Firebase CLI commands above; Vercel does not deploy backend functions.

Firebase Hosting may remain in `firebase.json` for emulator tooling, but is not needed for the production website and should not be deployed as a second frontend.
#   c o n f e s s i o n - c e t p  
 