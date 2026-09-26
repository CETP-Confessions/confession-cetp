const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { admin, db, FieldValue } = require('./shared');

const notifyDestinationOwner = onDocumentCreated('messages/{messageId}', async (event) => {
  const message = event.data?.data();
  if (!message || !['pending', 'needs_review'].includes(message.status)) return;
  const destination = await db.collection('destinations').doc(message.destinationId).get();
  if (!destination.exists) return;
  const owner = await db.collection('users').doc(destination.data().ownerId).get();
  const tokens = owner.data()?.fcmTokens;
  if (!Array.isArray(tokens) || !tokens.length) return;
  const result = await admin.messaging().sendEachForMulticast({
    tokens,
    notification: { title: 'A new anonymous note', body: 'There’s a note waiting in your inbox.' },
    data: { destinationId: message.destinationId },
  });
  const invalid = result.responses.flatMap((response, index) => response.success ? [] : [tokens[index]]);
  if (invalid.length) await owner.ref.update({ fcmTokens: FieldValue.arrayRemove(...invalid) });
});

module.exports = { notifyDestinationOwner };