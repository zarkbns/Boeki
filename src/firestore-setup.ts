/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';
import firebaseConfigJson from '../firebase-applet-config.json';

// Safe environment variable helper supporting both client-side Vite and server-side Node runtimes
const getEnvValue = (key: string): string | undefined => {
  let val: string | undefined = undefined;

  // 1. Check process.env (Server-side Node / tsx)
  if (typeof process !== 'undefined' && process.env) {
    if (process.env[key]) val = process.env[key];
    if (!val) {
      const unPrefixed = key.startsWith('VITE_') ? key.replace('VITE_', '') : '';
      if (unPrefixed && process.env[unPrefixed]) val = process.env[unPrefixed];
    }
  }

  // 2. Check import.meta.env (Client-side Vite bundle)
  if (!val) {
    try {
      const metaEnv = (import.meta as any).env;
      if (metaEnv && metaEnv[key]) val = metaEnv[key];
    } catch (e) {
      // Ignore ReferenceError on non-client environments
    }
  }

  // Filter out any placeholder strings to trigger correct config fallbacks
  if (val) {
    const uppercaseVal = val.toUpperCase();
    if (
      val.trim() === '' ||
      uppercaseVal.includes('PLACEHOLDER') ||
      uppercaseVal.startsWith('YOUR_') ||
      uppercaseVal.startsWith('MY_')
    ) {
      return undefined;
    }
  }

  return val;
};

// Resolve configuration strictly using environment variables or fallback safely to JSON config
const firebaseConfig = {
  projectId: getEnvValue('VITE_FIREBASE_PROJECT_ID') || firebaseConfigJson.projectId,
  appId: getEnvValue('VITE_FIREBASE_APP_ID') || firebaseConfigJson.appId,
  apiKey: getEnvValue('VITE_FIREBASE_API_KEY') || firebaseConfigJson.apiKey,
  authDomain: getEnvValue('VITE_FIREBASE_AUTH_DOMAIN') || firebaseConfigJson.authDomain,
  firestoreDatabaseId: getEnvValue('VITE_FIREBASE_FIRESTORE_DATABASE_ID') || firebaseConfigJson.firestoreDatabaseId,
  storageBucket: getEnvValue('VITE_FIREBASE_STORAGE_BUCKET') || firebaseConfigJson.storageBucket,
  messagingSenderId: getEnvValue('VITE_FIREBASE_MESSAGING_SENDER_ID') || firebaseConfigJson.messagingSenderId,
  measurementId: getEnvValue('VITE_FIREBASE_MEASUREMENT_ID') || firebaseConfigJson.measurementId,
};

// Initialize the Firebase app with secure configuration
const app = initializeApp(firebaseConfig);

// Export our Firestore database using the explicit firestoreDatabaseId
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const storage = getStorage(app);

/**
 * Validates connection to the Firestore database
 */
async function testConnection() {
  try {
    const { doc, getDocFromServer } = await import('firebase/firestore');
    await getDocFromServer(doc(db, 'trading_strategies', 'connection-test'));
    console.log('Successfully validated secure connection to Firestore Database.');
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase connectivity configuration on the application runner.', error);
    }
  }
}

testConnection();
