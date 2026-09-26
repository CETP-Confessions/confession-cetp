const { onCall } = require('firebase-functions/v2/https');
const { db, FieldValue, HttpsError, callableOptions, requireSignedIn } = require('./shared');

const getPublicDestination = onCall(callableOptions(20), async (request) => {
  const type = String(request.data?.type || 'user');
  const slug = String(request.data?.slug || '').trim().toLowerCase();
  if (!['user', 'organization'].includes(type) || !/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/.test(slug)) {
    throw new HttpsError('invalid-argument', 'This destination is unavailable.');
  }
  const matches = await db.collection('destinations')
    .where('slug', '==', slug)
    .where('type', '==', type === 'user' ? 'individual' : 'organization')
    .where('active', '==', true)
    .limit(1)
    .get();
  const found = matches.docs[0];
  if (!found) throw new HttpsError('not-found', 'This inbox is unavailable.');
  const destination = found.data();
  return {
    name: destination.name,
    slug: destination.slug,
    type: destination.type === 'individual' ? 'individual' : 'organization',
    description: destination.description || '',
    avatarUrl: destination.avatarUrl || '',
    active: destination.active === true,
    allowMessages: destination.allowMessages === true,
    allowMedia: destination.allowMedia === true,
  };
});

const createDestination = onCall(callableOptions(10), async (request) => {
  const auth = requireSignedIn(request);
  if (auth.token.firebase?.sign_in_provider === 'anonymous') {
    throw new HttpsError('permission-denied', 'An account is required to create an inbox.');
  }
  const user = await db.collection('users').doc(auth.uid).get();
  if (!user.exists || user.data().active !== true) {
    throw new HttpsError('permission-denied', 'An active account is required to create an inbox.');
  }
  const name = String(request.data?.name || '').trim().slice(0, 80);
  const slug = String(request.data?.slug || '').trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/.test(slug)) {
    throw new HttpsError('invalid-argument', 'Choose a link name using 3–40 letters, numbers, or hyphens.');
  }
  if (!name) throw new HttpsError('invalid-argument', 'A destination name is required.');

  const id = db.collection('destinations').doc().id;
  const destinationRef = db.collection('destinations').doc(id);
  const slugRef = db.collection('_destinationSlugs').doc(slug);
  await db.runTransaction(async (transaction) => {
    if ((await transaction.get(slugRef)).exists) throw new HttpsError('already-exists', 'That link name is already in use.');
    transaction.create(slugRef, { destinationId: id, createdAt: FieldValue.serverTimestamp() });
    transaction.create(destinationRef, {
      ownerId: auth.uid,
      organizationId: null,
      parentDestinationId: null,
      name,
      slug,
      type: 'individual',
      description: 'Send me an anonymous message',
      avatarUrl: '',
      active: true,
      allowMessages: true,
      allowMedia: true,
      moderationEnabled: true,
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  return { slug, name, url: `/u/${slug}` };
});

module.exports = { getPublicDestination, createDestination };