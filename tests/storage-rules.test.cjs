const fs = require('node:fs');
const path = require('node:path');
const { after, before, test } = require('node:test');
const {
  assertFails,
  initializeTestEnvironment,
} = require('@firebase/rules-unit-testing');
const { ref, uploadBytes } = require('firebase/storage');

let environment;

before(async () => {
  environment = await initializeTestEnvironment({
    projectId: 'demo-quietdrop',
    firestore: {
      rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8'),
    },
    storage: {
      rules: fs.readFileSync(path.join(__dirname, '..', 'storage.rules'), 'utf8'),
    },
  });
});

after(async () => {
  await environment.cleanup();
});

test('unauthenticated clients cannot upload arbitrary Storage objects', async () => {
  const storage = environment.unauthenticatedContext().storage();
  await assertFails(uploadBytes(ref(storage, 'anything/anything.txt'), new Uint8Array([1, 2, 3]), {
    contentType: 'text/plain',
  }));
});

test('signed-in account clients cannot bypass upload reservations', async () => {
  const storage = environment.authenticatedContext('account-user').storage();
  await assertFails(uploadBytes(ref(storage, 'messageUploads/not-reserved/photo.jpg'), new Uint8Array([1, 2, 3]), {
    contentType: 'image/jpeg',
  }));
});