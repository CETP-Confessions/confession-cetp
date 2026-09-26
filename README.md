# Quietdrop

Quietdrop is a Vite web application backed by Firebase. Local development connects to the configured Firebase project, not to emulators. Recipients create an account and a private destination link; visitors can submit text and optional images, GIFs, or short video without registering. Firebase Anonymous Authentication is used as a short-lived upload credential, but its UID is not written to the message or exposed to the recipient. The recipient-facing wording is: **Your identity isn't shown to the recipient.** Local actions affect real Firebase data, so use clearly labeled test accounts and messages.

## Included

- Email/password account registration and sign-in, individual destination links, owner-only inbox, status filtering, media previews, and moderation actions.
- Callable Functions for destination creation, anonymous upload reservations and message submission, rule-based moderation, reports, deletion, notifications, and abandoned-upload cleanup.
- Private Storage paths guarded by upload reservations, MIME/size rules, server-side content-signature checks, and owner-only reads.
- Firestore and Storage rules, App Check enforcement for callable Functions, rate limits, Firestore indexes, and Vercel SPA rewrites.
- Rules tests that verify inbox isolation, public destination access, and denial of client message writes.

The personal inbox flow is implemented end to end once the existing Firebase project is configured. Organization/department administration, anonymous reply conversations, QR generation, and client-side FCM token enrollment are not implemented yet. FCM delivery is wired for accounts that have registered tokens. These are not simulated UI features.

## Prerequisites

- Node.js 22 or later and npm.
- A configured Web App for the existing Firebase project `confession-cetp`.
- The required Firebase services, callable Functions, and App Check provider must already be configured by the project owner. This repository does not configure or deploy cloud resources.

## Install

```powershell
npm install
npm --prefix functions install
Copy-Item .env.example .env.development.local
```

Copy the Firebase Web App values into `.env.development.local`. The values in this file point the local browser directly at the real Firebase project; Auth, Firestore, Storage, and callable requests can create or change real data. Do not use destructive test data or operations. A reCAPTCHA Enterprise site key is required when callable Functions enforce App Check.

```dotenv
VITE_FIREBASE_API_KEY=the-existing-web-app-api-key
VITE_FIREBASE_AUTH_DOMAIN=confession-cetp.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=confession-cetp
VITE_FIREBASE_DATABASE_URL=https://confession-cetp-default-rtdb.asia-southeast1.firebasedatabase.app
VITE_FIREBASE_STORAGE_BUCKET=confession-cetp.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=77355569643
VITE_FIREBASE_APP_ID=the-existing-web-app-id
VITE_FIREBASE_MEASUREMENT_ID=the-existing-measurement-id
VITE_RECAPTCHA_ENTERPRISE_SITE_KEY=
VITE_MAX_IMAGE_MB=10
VITE_MAX_VIDEO_MB=50
```

Run the app locally:

```powershell
npm run dev
```

Open the Vite URL printed by the dev server. No emulator connections are made by the frontend. Use test identities and data with a `LOCAL_TEST_` or `DEV_TEST_` prefix. Do not run the emulator or deployment scripts as part of this local workflow.

## Rules Tests

```powershell
npm run test:rules
```

The existing rules test script starts the Firestore and Storage Emulators. It is intentionally not part of the real-Firebase local run described here and must not be run for this workflow. Do not substitute real-project data for emulator rule tests.

## Firebase Prerequisites

The local frontend uses the existing Firebase Web App configuration from `.env.development.local`. Email/password and anonymous Authentication providers, Firestore, Storage, callable Functions, and App Check must be available in the existing project before the complete flow can work. The callable Functions enforce App Check; if the local site key is blank or the local origin is not configured for the provider, public destination lookups and submissions will be rejected. Configure those services manually in Firebase Console. This repository does not sign in to the Firebase CLI, change project resources, modify rules, or deploy Functions.

Firebase Web settings are public client configuration, not server credentials. Never put Admin SDK keys in frontend files. Functions rate-limit defaults are `MAX_MESSAGES_PER_IP_PER_MINUTE` (8), `MAX_MESSAGES_PER_DESTINATION_PER_MINUTE` (5), `MAX_ATTACHMENTS_PER_MESSAGE` (3), `MAX_IMAGE_MB` (10), and `MAX_VIDEO_MB` (50). Storage rules enforce hard ceilings of 10 MB for images/GIFs and 50 MB for video.

## Data and Security Notes

Destination documents contain owner/admin fields but cannot be read directly by clients; a callable returns an allowlisted display projection for public links. Message documents contain destination ID, text, safe Storage paths, category, status, timestamps, and a report marker; they contain no sender UID, IP address, or moderation reasons. Moderation signals, anonymous upload reservations, hashed rate-limit keys, and message fingerprints live in server-only collections denied by Firestore rules. Successful anonymous Auth identities are deleted after submission. Uploaded objects are readable only by the destination owner after a completed reservation. Download tokens are not stored in message documents.

The Realtime Database client is initialized as `realtimeDb` using `VITE_FIREBASE_DATABASE_URL`. Current destinations, inbox messages, reports, moderation state, and upload reservations remain Firestore-backed; adding the RTDB connection does not migrate those flows or their security rules.

All message and moderation writes go through callable Functions. Firestore client writes to messages are denied. App Check reduces unauthorized use but is not a replacement for Authentication, authorization, validation, or Security Rules. The current word/link/PII/repetition checks are heuristic flags for human review; they are not a promise that harmful content will be detected or that senders cannot be investigated for abuse or legal compliance.

## Build

```powershell
npm run build
npm run preview
```

The build does not access Firebase. Before exercising real callable flows from a local browser, the existing Functions deployment and App Check configuration must be ready for the local origin. No deployment is performed by `npm run build` or `npm run dev`.

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
```

The project brief contains conflicting `appId` and `measurementId` values in its two configuration examples. Confirm the values in the existing `confession-cetp` Web App settings and use that single configuration consistently; the measurement ID is optional for core messaging.
4. Deploy from Vercel and add the production domain to Firebase Authentication authorized domains and the Firebase App Check reCAPTCHA Enterprise configuration. Add Preview domains only if Preview deployments should access Firebase.
5. Verify registration provisions `/u/{username}`, a signed-out visitor can submit a note, and the owner can read it. Confirm Firestore, Storage, and Functions are the existing `confession-cetp` services.

Subsequent pushes to the connected GitHub branch trigger Vercel builds and deployments. Deploy Firebase rules and Functions separately with the Firebase CLI commands above; Vercel does not deploy backend functions.

Firebase Hosting may remain in `firebase.json` for emulator tooling, but is not needed for the production website and should not be deployed as a second frontend.
#   c o n f e s s i o n - c e t p 
 
 