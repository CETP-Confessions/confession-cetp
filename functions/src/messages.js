const crypto = require('node:crypto');
const { onCall } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const {
  db, bucket, admin, FieldValue, Timestamp, HttpsError, MIME_TYPES, requireAnonymous, requireDestinationOwner,
  callableOptions, hash, hashClientIp,
} = require('./shared');
const { moderateText } = require('./moderation');
const { resolvePublicDestination } = require('./destinations');

const WINDOW_MS = 60 * 1000;
const MAX_PER_IP = Number.parseInt(process.env.MAX_MESSAGES_PER_IP_PER_MINUTE || '8', 10);
const MAX_PER_DESTINATION = Number.parseInt(process.env.MAX_MESSAGES_PER_DESTINATION_PER_MINUTE || '5', 10);
const MAX_ATTACHMENTS = Number.parseInt(process.env.MAX_ATTACHMENTS_PER_MESSAGE || '3', 10);
const MAX_IMAGE_BYTES = Number.parseInt(process.env.MAX_IMAGE_MB || '10', 10) * 1024 * 1024;
const MAX_VIDEO_BYTES = Number.parseInt(process.env.MAX_VIDEO_MB || '50', 10) * 1024 * 1024;

function validSignature(type, bytes) {
  if (type === 'image/jpeg') return bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  if (type === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (type === 'image/webp') return bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (type === 'image/gif') return ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6));
  if (type === 'video/mp4') return bytes.toString('ascii', 4, 8) === 'ftyp';
  if (type === 'video/webm') return bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  return false;
}

async function checkRateLimit(ipHash, destinationId) {
  const now = Date.now();
  const refs = [
    db.collection('_rateLimits').doc(hash(`ip:${ipHash}`)),
    db.collection('_rateLimits').doc(hash(`destination:${destinationId}:${ipHash}`)),
  ];
  await db.runTransaction(async (transaction) => {
    const snapshots = await Promise.all(refs.map((reference) => transaction.get(reference)));
    const limits = [MAX_PER_IP, MAX_PER_DESTINATION];
    snapshots.forEach((snapshot, index) => {
      const data = snapshot.data();
      const count = data && now - data.windowStartedAt.toMillis() < WINDOW_MS ? data.count : 0;
      if (count >= limits[index]) throw new HttpsError('resource-exhausted', 'Please try again later.');
      transaction.set(refs[index], {
        count: count + 1,
        windowStartedAt: count ? data.windowStartedAt : Timestamp.fromMillis(now),
        expiresAt: Timestamp.fromMillis(now + 24 * 60 * 60 * 1000),
      });
    });
  });
}

const startMessageUpload = onCall(callableOptions(20), async (request) => {
  const auth = requireAnonymous(request);
  const route = request.data?.destination || {};
  const slug = String(route.slug || request.data?.destinationSlug || '').trim().toLowerCase();
  const type = String(route.type || 'individual');
  const organizationSlug = String(route.organizationSlug || '').trim().toLowerCase();
  const inputFiles = Array.isArray(request.data?.files) ? request.data.files : [];
  if (inputFiles.length > MAX_ATTACHMENTS) throw new HttpsError('invalid-argument', 'Too many attachments.');
  const destinationDoc = await resolvePublicDestination(type, slug, organizationSlug);
  if (!destinationDoc || !destinationDoc.data().allowMessages) throw new HttpsError('not-found', 'This inbox is unavailable.');
  const destination = destinationDoc.data();
  if (inputFiles.length && !destination.allowMedia) throw new HttpsError('failed-precondition', 'Media is not enabled for this inbox.');

  const ipHash = hashClientIp(request.rawRequest?.ip);
  await checkRateLimit(ipHash, destinationDoc.id);
  const requestId = crypto.randomBytes(20).toString('hex');
  const messageId = requestId;
  const files = inputFiles.map((input, index) => {
    const mime = MIME_TYPES[input?.contentType];
    const size = Number(input?.size);
    const maxBytes = mime?.type === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    if (!mime || !Number.isInteger(size) || size < 1 || size > Math.min(mime.maxBytes, maxBytes)) {
      throw new HttpsError('invalid-argument', 'One or more attachments are not allowed.');
    }
    const name = `attachment-${index + 1}.${mime.extension}`;
    return { name, path: `messages/${messageId}/${name}`, contentType: input.contentType, type: mime.type, size };
  });
  const expiresAt = Timestamp.fromMillis(Date.now() + 10 * 60 * 1000);
  await db.collection('uploadRequests').doc(requestId).create({
    uploaderUid: auth.uid,
    destinationId: destinationDoc.id,
    ownerId: destination.ownerId,
    messageId,
    state: 'uploading',
    uploadNames: files.map((file) => file.name),
    uploadTypes: Object.fromEntries(files.map((file) => [file.name, file.contentType])),
    uploadSizes: Object.fromEntries(files.map((file) => [file.name, file.size])),
    expiresAt,
    createdAt: FieldValue.serverTimestamp(),
  });
  return { requestId, uploads: files.map(({ path, name }) => ({ path, name })) };
});

const submitAnonymousMessage = onCall(callableOptions(20), async (request) => {
  const auth = requireAnonymous(request);
  const requestId = String(request.data?.requestId || '');
  const text = String(request.data?.text || '').trim();
  const submittedAttachments = Array.isArray(request.data?.attachments) ? request.data.attachments : [];
  if (!requestId || text.length < 1 || text.length > 4000) throw new HttpsError('invalid-argument', 'Write a message up to 4,000 characters.');

  const reservationRef = db.collection('uploadRequests').doc(requestId);
  const reservationSnapshot = await reservationRef.get();
  if (!reservationSnapshot.exists) throw new HttpsError('not-found', 'This submission has expired.');
  const reservation = reservationSnapshot.data();
  if (reservation.uploaderUid !== auth.uid || reservation.state !== 'uploading'
      || reservation.expiresAt.toMillis() < Date.now()) throw new HttpsError('permission-denied', 'This submission is no longer available.');
  if (submittedAttachments.length !== reservation.uploadNames.length) throw new HttpsError('invalid-argument', 'The attachments do not match this submission.');

  const attachments = [];
  for (const name of reservation.uploadNames) {
    const path = `messages/${reservation.messageId}/${name}`;
    const object = bucket.file(path);
    const [exists] = await object.exists();
    if (!exists) throw new HttpsError('failed-precondition', 'An attachment is missing.');
    const [metadata] = await object.getMetadata();
    const expectedType = reservation.uploadTypes[name];
    const expectedSize = reservation.uploadSizes[name];
    if (Number(metadata.size) !== expectedSize || metadata.contentType !== expectedType) {
      await object.delete({ ignoreNotFound: true });
      throw new HttpsError('invalid-argument', 'An attachment failed validation.');
    }
    const [bytes] = await object.download({ start: 0, end: 15 });
    if (!validSignature(expectedType, bytes)) {
      await object.delete({ ignoreNotFound: true });
      throw new HttpsError('invalid-argument', 'An attachment failed validation.');
    }
    attachments.push({ path, name, type: MIME_TYPES[expectedType].type });
  }

  const review = await moderateText(reservation.destinationId, text);
  const messageRef = db.collection('messages').doc(reservation.messageId);
  await db.runTransaction(async (transaction) => {
    const latest = await transaction.get(reservationRef);
    if (latest.data()?.state !== 'uploading') throw new HttpsError('already-exists', 'This message was already submitted.');
    transaction.create(messageRef, {
      destinationId: reservation.destinationId,
      text,
      attachments,
      category: 'message',
      status: review.status,
      createdAt: FieldValue.serverTimestamp(),
      readAt: null,
      archivedAt: null,
    });
    transaction.create(db.collection('moderationQueue').doc(reservation.messageId), {
      destinationId: reservation.destinationId,
      flags: review.flags,
      reviewedAt: null,
      createdAt: FieldValue.serverTimestamp(),
    });
    transaction.update(reservationRef, {
      state: 'complete',
      completedAt: FieldValue.serverTimestamp(),
      uploaderUid: FieldValue.delete(),
      uploadNames: FieldValue.delete(),
      uploadTypes: FieldValue.delete(),
      uploadSizes: FieldValue.delete(),
    });
    transaction.set(db.collection('messageFingerprints').doc(review.fingerprint), {
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000),
    });
  });
  await admin.auth().deleteUser(auth.uid).catch(() => {});
  return { status: review.status };
});

const moderateMessage = onCall(callableOptions(10), async (request) => {
  const auth = request.auth;
  if (!auth) throw new HttpsError('unauthenticated', 'Sign in is required.');
  const messageId = String(request.data?.messageId || '');
  const status = String(request.data?.status || '');
  if (!['approved', 'rejected', 'archived'].includes(status)) throw new HttpsError('invalid-argument', 'Invalid moderation action.');
  const messageRef = db.collection('messages').doc(messageId);
  const messageSnapshot = await messageRef.get();
  if (!messageSnapshot.exists) throw new HttpsError('not-found', 'Message not found.');
  const message = messageSnapshot.data();
  await requireDestinationOwner(auth, message.destinationId);
  await messageRef.update({
    status,
    ...(status === 'archived' ? { archivedAt: FieldValue.serverTimestamp() } : {}),
    ...(status === 'approved' || status === 'rejected' ? { readAt: FieldValue.serverTimestamp() } : {}),
  });
  await db.collection('moderationQueue').doc(messageId).update({
    reviewedAt: FieldValue.serverTimestamp(),
  }).catch(() => {});
  return { ok: true };
});

const markMessageRead = onCall(callableOptions(10), async (request) => {
  const auth = request.auth;
  if (!auth) throw new HttpsError('unauthenticated', 'Sign in is required.');
  const messageRef = db.collection('messages').doc(String(request.data?.messageId || ''));
  const message = await messageRef.get();
  if (!message.exists) throw new HttpsError('not-found', 'Message not found.');
  await requireDestinationOwner(auth, message.data().destinationId);
  if (!message.data().readAt) {
    await messageRef.update({ readAt: FieldValue.serverTimestamp() });
  }
  return { ok: true };
});

const deleteMessage = onCall(callableOptions(10), async (request) => {
  const auth = request.auth;
  if (!auth) throw new HttpsError('unauthenticated', 'Sign in is required.');
  const messageRef = db.collection('messages').doc(String(request.data?.messageId || ''));
  const messageSnapshot = await messageRef.get();
  if (!messageSnapshot.exists) throw new HttpsError('not-found', 'Message not found.');
  await requireDestinationOwner(auth, messageSnapshot.data().destinationId);
  await Promise.all((messageSnapshot.data().attachments || []).map((attachment) => (
    bucket.file(attachment.path).delete({ ignoreNotFound: true })
  )));
  const reservation = await db.collection('uploadRequests').where('messageId', '==', messageRef.id).limit(1).get();
  await Promise.all([
    messageRef.delete(),
    db.collection('moderationQueue').doc(messageRef.id).delete(),
    ...reservation.docs.map((document) => document.ref.delete()),
  ]);
  return { ok: true };
});

const cleanupExpiredUploads = onSchedule('every 24 hours', async () => {
  const expired = await db.collection('uploadRequests')
    .where('state', '==', 'uploading')
    .where('expiresAt', '<=', Timestamp.now())
    .limit(100)
    .get();
  await Promise.all(expired.docs.map(async (reservation) => {
    await Promise.all(reservation.data().uploadNames.map((name) => (
      bucket.file(`messages/${reservation.data().messageId}/${name}`).delete({ ignoreNotFound: true })
    )));
    if (reservation.data().uploaderUid) {
      await admin.auth().deleteUser(reservation.data().uploaderUid).catch(() => {});
    }
    await reservation.ref.delete();
  }));
  for (const collectionName of ['_rateLimits', 'messageFingerprints']) {
    const stale = await db.collection(collectionName)
      .where('expiresAt', '<=', Timestamp.now())
      .limit(400)
      .get();
    if (stale.size) {
      const batch = db.batch();
      stale.docs.forEach((document) => batch.delete(document.ref));
      await batch.commit();
    }
  }
});

module.exports = { startMessageUpload, submitAnonymousMessage, moderateMessage, markMessageRead, deleteMessage, cleanupExpiredUploads };