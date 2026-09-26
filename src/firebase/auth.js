import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from 'firebase/auth';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from './config.js';
import { createDestination } from './api.js';

export function observeSession(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function registerAccount({ displayName, email, password }) {
  const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
  const cleanName = displayName.trim();
  const usernameBase = cleanName.toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '').slice(0, 30) || 'inbox';
  const username = `${usernameBase}-${credential.user.uid.slice(0, 6).toLowerCase()}`;
  await updateProfile(credential.user, { displayName: cleanName });
  await setDoc(doc(db, 'users', credential.user.uid), {
    username,
    displayName: cleanName,
    email: credential.user.email,
    role: 'user',
    active: true,
    createdAt: serverTimestamp(),
  });
  await createDestination({ name: cleanName, slug: username });
  return credential.user;
}

export async function loginAccount({ email, password }) {
  const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
  return credential.user;
}

export function logoutAccount() {
  return signOut(auth);
}

export function resetPassword(email) {
  return sendPasswordResetEmail(auth, email.trim());
}

export async function ensureAnonymousSession() {
  if (auth.currentUser?.isAnonymous) return auth.currentUser;
  if (auth.currentUser) throw new Error('Open this link in a signed-out browser to send a note.');
  return (await signInAnonymously(auth)).user;
}