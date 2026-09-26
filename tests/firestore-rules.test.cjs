const fs = require('node:fs');
const path = require('node:path');
const { after, before, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} = require('@firebase/rules-unit-testing');
const { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, where } = require('firebase/firestore');

let environment;

before(async () => {
  environment = await initializeTestEnvironment({
    projectId: 'demo-quietdrop',
    firestore: {
      rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8'),
    },
  });
});

beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'destinations', 'dest-a'), {
      ownerId: 'owner-a', organizationId: null, active: true, allowMessages: true,
    });
    await setDoc(doc(db, 'destinations', 'dest-b'), {
      ownerId: 'owner-b', organizationId: null, active: true, allowMessages: true,
    });
    await setDoc(doc(db, 'destinations', 'closed'), {
      ownerId: 'owner-a', organizationId: null, active: false, allowMessages: false,
    });
    await setDoc(doc(db, 'messages', 'message-a'), {
      destinationId: 'dest-a', text: 'Hello', status: 'pending',
    });
    await setDoc(doc(db, 'messages', 'message-b'), {
      destinationId: 'dest-b', text: 'Private', status: 'pending',
    });
  });
});

after(async () => {
  await environment.cleanup();
});

test('destination owner can read only their inbox', async () => {
  const db = environment.authenticatedContext('owner-a').firestore();
  await assertSucceeds(getDoc(doc(db, 'messages', 'message-a')));
  await assertFails(getDoc(doc(db, 'messages', 'message-b')));
  const destinations = await assertSucceeds(getDocs(query(
    collection(db, 'destinations'), where('ownerId', '==', 'owner-a'),
  )));
  assert.equal(destinations.size, 2);
  const inbox = await assertSucceeds(getDocs(query(
    collection(db, 'messages'), where('destinationId', '==', 'dest-a'),
  )));
  assert.equal(inbox.size, 1);
});

test('unauthenticated visitors cannot read messages or write message documents', async () => {
  const db = environment.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, 'messages', 'message-a')));
  await assertFails(setDoc(doc(db, 'messages', 'forged'), {
    destinationId: 'dest-a', text: 'Forged write', status: 'pending',
  }));
});

test('destination documents cannot be read by public clients', async () => {
  const db = environment.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, 'destinations', 'closed')));
  await assertFails(getDoc(doc(db, 'destinations', 'dest-a')));
  const ownerDb = environment.authenticatedContext('owner-a').firestore();
  await assertSucceeds(getDoc(doc(ownerDb, 'destinations', 'dest-a')));
});

test('owner cannot read internal moderation records', async () => {
  const db = environment.authenticatedContext('owner-a').firestore();
  await assertFails(getDoc(doc(db, 'moderationQueue', 'message-a')));
});

test('new user profiles can store a username but cannot self-assign privileged roles', async () => {
  const db = environment.authenticatedContext('new-owner').firestore();
  await assertSucceeds(setDoc(doc(db, 'users', 'new-owner'), {
    username: 'shahin-a1b2c3',
    displayName: 'Shahin',
    email: 'owner@example.test',
    role: 'user',
    active: true,
    createdAt: serverTimestamp(),
  }));
  await assertFails(setDoc(doc(db, 'users', 'forged-admin'), {
    username: 'admin-a1b2c3',
    displayName: 'Admin',
    email: 'admin@example.test',
    role: 'super_admin',
    active: true,
    createdAt: serverTimestamp(),
  }));
});