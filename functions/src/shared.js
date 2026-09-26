const crypto = require('node:crypto');
const admin = require('firebase-admin');
const { FieldValue, Timestamp } = require('firebase-admin/firestore');
const { HttpsError } = require('firebase-functions/v2/https');

let firebaseConfig = {};
try {
  firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG || '{}');
} catch {
  firebaseConfig = {};
}
const projectId = firebaseConfig.projectId || process.env.GCLOUD_PROJECT;
const storageBucket = process.env.STORAGE_BUCKET
  || firebaseConfig.storageBucket
  || (projectId ? `${projectId}.firebasestorage.app` : undefined);

if (!admin.apps.length) {
  admin.initializeApp({
    ...firebaseConfig,
    ...(projectId ? { projectId } : {}),
    ...(storageBucket ? { storageBucket } : {}),
  });
}

const db = admin.firestore();
const bucket = admin.storage().bucket();
const isFunctionsEmulator = process.env.FUNCTIONS_EMULATOR === 'true';
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const MIME_TYPES = Object.freeze({
  'image/jpeg': { type: 'image', extension: 'jpg', maxBytes: MAX_IMAGE_BYTES },
  'image/png': { type: 'image', extension: 'png', maxBytes: MAX_IMAGE_BYTES },
  'image/webp': { type: 'image', extension: 'webp', maxBytes: MAX_IMAGE_BYTES },
  'image/gif': { type: 'gif', extension: 'gif', maxBytes: MAX_IMAGE_BYTES },
  'video/mp4': { type: 'video', extension: 'mp4', maxBytes: MAX_VIDEO_BYTES },
  'video/webm': { type: 'video', extension: 'webm', maxBytes: MAX_VIDEO_BYTES },
});

function requireSignedIn(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in is required.');
  return request.auth;
}

function callableOptions(maxInstances = 20) {
  return {
    enforceAppCheck: !isFunctionsEmulator,
    maxInstances,
  };
}

function requireAnonymous(request) {
  const auth = requireSignedIn(request);
  if (auth.token.firebase?.sign_in_provider !== 'anonymous') {
    throw new HttpsError('permission-denied', 'This operation is not available.');
  }
  return auth;
}

async function requireDestinationOwner(auth, destinationId) {
  const snapshot = await db.collection('destinations').doc(destinationId).get();
  if (!snapshot.exists) throw new HttpsError('not-found', 'Destination not found.');
  const destination = snapshot.data();
  if (auth.token.role === 'super_admin' || destination.ownerId === auth.uid) return destination;
  const user = await db.collection('users').doc(auth.uid).get();
  if (user.exists && user.data().role === 'organization_admin'
      && user.data().organizationId === destination.organizationId) return destination;
  throw new HttpsError('permission-denied', 'You cannot access this destination.');
}

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hashClientIp(ip) {
  const salt = process.env.RATE_LIMIT_SALT || process.env.GCLOUD_PROJECT || 'quietdrop';
  return crypto.createHmac('sha256', salt).update(ip || 'unknown').digest('hex');
}

module.exports = {
  admin, db, bucket, FieldValue, Timestamp, HttpsError, MIME_TYPES, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES,
  callableOptions, requireSignedIn, requireAnonymous, requireDestinationOwner, hash, hashClientIp,
};