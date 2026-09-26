import { getApp, getApps, initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAuth } from 'firebase/auth';
import { getDatabase } from 'firebase/database';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { getStorage } from 'firebase/storage';

const env = import.meta.env;

export const firebaseConfigured = Boolean(
  env.VITE_FIREBASE_API_KEY && env.VITE_FIREBASE_PROJECT_ID && env.VITE_FIREBASE_APP_ID,
);

const appConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || 'missing-api-key',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || 'localhost',
  projectId: env.VITE_FIREBASE_PROJECT_ID || 'demo-quietdrop',
  databaseURL: env.VITE_FIREBASE_DATABASE_URL || 'https://confession-cetp-default-rtdb.asia-southeast1.firebasedatabase.app',
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || 'demo-quietdrop.appspot.com',
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || '000000000000',
  appId: env.VITE_FIREBASE_APP_ID || '1:000000000000:web:0000000000000000000000',
  measurementId: env.VITE_FIREBASE_MEASUREMENT_ID || '',
};

export const firebaseApp = getApps().length ? getApp() : initializeApp(appConfig);

if (env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY && !import.meta.hot?.data.appCheckInitialized) {
  initializeAppCheck(firebaseApp, {
    provider: new ReCaptchaEnterpriseProvider(env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY),
    isTokenAutoRefreshEnabled: true,
  });
  if (import.meta.hot) import.meta.hot.data.appCheckInitialized = true;
}

export const auth = getAuth(firebaseApp);
export const realtimeDb = getDatabase(firebaseApp);
export const db = getFirestore(firebaseApp);
export const functions = getFunctions(firebaseApp, 'us-central1');
export const storage = getStorage(firebaseApp);
