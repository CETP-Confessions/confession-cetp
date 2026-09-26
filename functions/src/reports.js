const { onCall } = require('firebase-functions/v2/https');
const { db, admin, FieldValue, HttpsError, callableOptions, requireSignedIn, requireDestinationOwner } = require('./shared');

const createReport = onCall(callableOptions(10), async (request) => {
  const auth = requireSignedIn(request);
  const messageId = String(request.data?.messageId || '');
  const reason = String(request.data?.reason || '').trim().slice(0, 500);
  const message = await db.collection('messages').doc(messageId).get();
  if (!message.exists) throw new HttpsError('not-found', 'Message not found.');
  await requireDestinationOwner(auth, message.data().destinationId);
  const reportRef = db.collection('reports').doc();
  await db.runTransaction(async (transaction) => {
    transaction.create(reportRef, {
      messageId,
      destinationId: message.data().destinationId,
      reason: reason || 'Other',
      status: 'pending',
      createdAt: FieldValue.serverTimestamp(),
    });
    transaction.update(message.ref, { reported: true });
  });
  return { reportId: reportRef.id };
});

module.exports = { createReport };