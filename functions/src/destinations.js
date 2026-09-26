const { onCall } = require('firebase-functions/v2/https');
const { db, FieldValue, HttpsError, callableOptions, requireSignedIn, hash } = require('./shared');
const { availableSlug, destinationPath, slugify } = require('./destinationLinks');

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/;
const DESTINATION_TYPES = new Set(['individual', 'organization', 'department', 'group']);

function normalizedType(type) {
  if (type === 'user') return 'individual';
  if (type === 'organization') return 'organization';
  return type;
}

function slugLock(type, parentDestinationId, slug) {
  const routeScope = ['department', 'group'].includes(type)
    ? `child:${parentDestinationId}`
    : type === 'organization' ? 'organization' : 'individual';
  return db.collection('_destinationSlugs').doc(hash(`${routeScope}:${slug}`));
}

function sameRouteScope(destination, type, parentDestinationId) {
  const isChildType = ['department', 'group'].includes(type);
  if (isChildType !== ['department', 'group'].includes(destination.type)) return false;
  if (!isChildType && destination.type !== type) return false;
  if (!isChildType) return true;
  return destination.parentDestinationId === parentDestinationId
    || destination.organizationId === parentDestinationId;
}

async function allocateSlug(transaction, type, base, parentDestinationId, destinationId) {
  const routeScope = ['department', 'group'].includes(type) ? parentDestinationId : type;
  const usedSlugs = new Set();
  for (let duplicateIndex = 0; duplicateIndex < 100; duplicateIndex += 1) {
    const candidate = availableSlug(base, usedSlugs);
    const lockRef = slugLock(type, parentDestinationId, candidate);
    const [lockSnapshot, matches] = await Promise.all([
      transaction.get(lockRef),
      transaction.get(db.collection('destinations').where('slug', '==', candidate)),
    ]);
    const existing = matches.docs.some((document) => document.id !== destinationId
      && sameRouteScope(document.data(), type, parentDestinationId));
    if (!lockSnapshot.exists && !existing) {
      transaction.create(lockRef, {
        destinationId,
        routeScope,
        slug: candidate,
        createdAt: FieldValue.serverTimestamp(),
      });
      return candidate;
    }
    usedSlugs.add(candidate);
  }
  throw new HttpsError('resource-exhausted', 'Unable to generate an available link. Try a different name.');
}

async function findOrganization(organizationSlug) {
  const matches = await db.collection('destinations').where('slug', '==', organizationSlug).get();
  return matches.docs.find((document) => document.data().type === 'organization'
    && document.data().active === true) || null;
}

async function resolvePublicDestination(type, slug, organizationSlug = '') {
  const destinationType = normalizedType(type);
  if ((!DESTINATION_TYPES.has(destinationType) && destinationType !== 'child') || !SLUG_PATTERN.test(slug)) return null;
  let parentDestinationId = null;
  let organization = null;
  if (destinationType === 'child' || ['department', 'group'].includes(destinationType)) {
    if (!SLUG_PATTERN.test(organizationSlug)) return null;
    organization = await findOrganization(organizationSlug);
    if (!organization) return null;
    parentDestinationId = organization.id;
  }
  const matches = await db.collection('destinations').where('slug', '==', slug).get();
  return matches.docs.find((document) => {
    const destination = document.data();
    if (destinationType === 'child'
        && !['department', 'group'].includes(destination.type)) return false;
    if (destinationType === 'child') {
      return (destination.parentDestinationId === parentDestinationId
        || destination.organizationId === parentDestinationId)
      && destination.active === true;
    }
    return sameRouteScope(destination, destinationType, parentDestinationId)
      && destination.active === true;
  }) || null;
}

function publicProjection(document, organizationSlug = '') {
  const destination = document.data();
  return {
    name: destination.name,
    slug: destination.slug,
    type: destination.type,
    organizationSlug: organizationSlug || destination.organizationSlug || '',
    path: destination.publicPath || destinationPath({
      type: destination.type,
      slug: destination.slug,
      organizationSlug: organizationSlug || destination.organizationSlug,
    }),
    description: destination.description || '',
    avatarUrl: destination.avatarUrl || '',
    active: destination.active === true,
    allowMessages: destination.allowMessages === true,
    allowMedia: destination.allowMedia === true,
  };
}

const getPublicDestination = onCall(callableOptions(20), async (request) => {
  const type = String(request.data?.type || 'user') === 'child'
    ? 'child'
    : normalizedType(String(request.data?.type || 'user'));
  const slug = String(request.data?.slug || '').trim().toLowerCase();
  const organizationSlug = String(request.data?.organizationSlug || '').trim().toLowerCase();
  if ((!DESTINATION_TYPES.has(type) && type !== 'child') || !SLUG_PATTERN.test(slug)
      || (['department', 'group', 'child'].includes(type) && !SLUG_PATTERN.test(organizationSlug))) {
    throw new HttpsError('invalid-argument', 'This destination is unavailable.');
  }
  const found = await resolvePublicDestination(type, slug, organizationSlug);
  if (!found) throw new HttpsError('not-found', 'This inbox is unavailable.');
  return publicProjection(found, organizationSlug);
});

const createDestination = onCall(callableOptions(10), async (request) => {
  const auth = requireSignedIn(request);
  if (auth.token.firebase?.sign_in_provider === 'anonymous') {
    throw new HttpsError('permission-denied', 'An account is required to create a destination.');
  }
  const userRef = db.collection('users').doc(auth.uid);
  const userSnapshot = await userRef.get();
  if (!userSnapshot.exists || userSnapshot.data().active !== true) {
    throw new HttpsError('permission-denied', 'An active account is required to create a destination.');
  }
  const user = userSnapshot.data();
  const name = String(request.data?.name || '').trim().slice(0, 80);
  const type = normalizedType(String(request.data?.type || 'individual'));
  if (!name) throw new HttpsError('invalid-argument', 'A destination name is required.');
  if (!DESTINATION_TYPES.has(type)) throw new HttpsError('invalid-argument', 'Choose a valid destination type.');

  let parent = null;
  if (['department', 'group'].includes(type)) {
    const organizationSlug = String(request.data?.organizationSlug || '').trim().toLowerCase();
    if (!SLUG_PATTERN.test(organizationSlug)) {
      throw new HttpsError('invalid-argument', 'Enter a valid organization link name.');
    }
    parent = await findOrganization(organizationSlug);
    if (!parent) throw new HttpsError('not-found', 'The organization destination was not found.');
    const isOrganizationAdmin = user.role === 'organization_admin'
      && user.organizationId === parent.id;
    const isSuperAdmin = user.role === 'super_admin' || auth.token.role === 'super_admin';
    if (!isOrganizationAdmin && !isSuperAdmin) {
      throw new HttpsError('permission-denied', 'You cannot create a destination for this organization.');
    }
  } else if (type === 'organization'
      && user.role !== 'super_admin' && auth.token.role !== 'super_admin') {
    throw new HttpsError('permission-denied', 'Only a platform administrator can create an organization destination.');
  }

  const destinationRef = db.collection('destinations').doc();
  let createdDestination;
  await db.runTransaction(async (transaction) => {
    const freshUser = await transaction.get(userRef);
    if (!freshUser.exists || freshUser.data().active !== true) {
      throw new HttpsError('permission-denied', 'An active account is required to create a destination.');
    }
    const parentDestinationId = parent?.id || null;
    const slug = await allocateSlug(transaction, type, slugify(name), parentDestinationId, destinationRef.id);
    const organizationSlug = type === 'organization' ? slug : parent?.data().slug || '';
    const record = {
      ownerId: auth.uid,
      organizationId: parentDestinationId,
      parentDestinationId,
      organizationSlug,
      name,
      slug,
      type,
      publicPath: destinationPath({ type, slug, organizationSlug }),
      description: 'Send an anonymous message',
      avatarUrl: '',
      active: true,
      allowMessages: true,
      allowMedia: true,
      moderationEnabled: true,
      createdAt: FieldValue.serverTimestamp(),
    };
    transaction.create(destinationRef, record);
    if (type === 'individual') transaction.update(userRef, { username: slug });
    createdDestination = { id: destinationRef.id, ...record, slug };
  });
  return {
    id: destinationRef.id,
    slug: createdDestination.slug,
    type,
    organizationSlug: createdDestination.organizationSlug,
    path: createdDestination.publicPath,
    name,
  };
});

const ensureDestinationLink = onCall(callableOptions(10), async (request) => {
  const auth = requireSignedIn(request);
  const destinationId = String(request.data?.destinationId || '');
  const destinationRef = db.collection('destinations').doc(destinationId);
  const initial = await destinationRef.get();
  if (!initial.exists) throw new HttpsError('not-found', 'Destination not found.');
  const initialData = initial.data();
  const isOwner = initialData.ownerId === auth.uid;
  const userRef = db.collection('users').doc(auth.uid);
  const userSnapshot = await userRef.get();
  const user = userSnapshot.data() || {};
  const isOrgAdmin = user.role === 'organization_admin'
    && user.organizationId === initialData.organizationId;
  if (!isOwner && !isOrgAdmin && auth.token.role !== 'super_admin') {
    throw new HttpsError('permission-denied', 'You cannot manage this destination.');
  }
  const type = normalizedType(initialData.type || 'individual');
  if (!DESTINATION_TYPES.has(type)) throw new HttpsError('failed-precondition', 'This destination type has no public route.');
  let parent = null;
  if (['department', 'group'].includes(type)) {
    const parentId = initialData.parentDestinationId || initialData.organizationId;
    if (!parentId) throw new HttpsError('failed-precondition', 'The parent organization is missing.');
    parent = await db.collection('destinations').doc(parentId).get();
    if (!parent.exists || parent.data().type !== 'organization') {
      throw new HttpsError('failed-precondition', 'The parent organization is unavailable.');
    }
  }

  let result;
  await db.runTransaction(async (transaction) => {
    const currentSnapshot = await transaction.get(destinationRef);
    if (!currentSnapshot.exists) throw new HttpsError('not-found', 'Destination not found.');
    const current = currentSnapshot.data();
    const organizationSlug = type === 'organization' ? current.slug : parent?.data().slug || '';
    if (current.slug && SLUG_PATTERN.test(current.slug)) {
      const path = current.publicPath || destinationPath({ type, slug: current.slug, organizationSlug });
      if (!current.publicPath) transaction.update(destinationRef, { publicPath: path, organizationSlug });
      result = { id: destinationRef.id, slug: current.slug, type, organizationSlug, path, name: current.name };
      return;
    }
    const base = slugify(current.name || user.username || 'inbox');
    const slug = await allocateSlug(transaction, type, base, parent?.id || null, destinationRef.id);
    const path = destinationPath({ type, slug, organizationSlug });
    transaction.update(destinationRef, { slug, publicPath: path, organizationSlug });
    if (type === 'individual') transaction.update(userRef, { username: slug });
    result = { id: destinationRef.id, slug, type, organizationSlug, path, name: current.name };
  });
  return result;
});

module.exports = { getPublicDestination, createDestination, ensureDestinationLink, resolvePublicDestination };