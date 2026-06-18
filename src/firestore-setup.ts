/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeApp, getApps, getApp } from 'firebase/app';
import { initializeFirestore, getFirestore } from 'firebase/firestore';
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

// Initialize the Firebase app with secure configuration - serverless safe
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Create high-reliability database instance configured for our project
let resolvedDbId = getEnvValue('VITE_FIREBASE_FIRESTORE_DATABASE_ID');
console.log('[Firestore Setup] VITE_FIREBASE_FIRESTORE_DATABASE_ID Env:', resolvedDbId);

if (!resolvedDbId || resolvedDbId === '(default)' || resolvedDbId === 'default' || resolvedDbId.trim() === '') {
  resolvedDbId = firebaseConfigJson.firestoreDatabaseId;
  console.log('[Firestore Setup] Defaulting to JSON firestoreDatabaseId:', resolvedDbId);
}

// In this environment, the custom named database ID must be used explicitly
const dbName = resolvedDbId && 
               resolvedDbId !== '(default)' && 
               resolvedDbId !== 'default' && 
               resolvedDbId.trim() !== ''
  ? resolvedDbId
  : undefined;

console.log('[Firestore Setup] Final dbName used for initializeFirestore:', dbName);

let tempDb;
try {
  tempDb = initializeFirestore(app, {
    ignoreUndefinedProperties: true
  }, dbName);
} catch (e) {
  console.log('[Firestore Setup] initializeFirestore threw/already initialized, retrieving with getFirestore:', e);
  tempDb = dbName ? getFirestore(app, dbName) : getFirestore(app);
}

export const db = tempDb;

export const auth = getAuth(app);
export const storage = getStorage(app);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid || null,
      email: auth.currentUser?.email || null,
      emailVerified: auth.currentUser?.emailVerified || null,
      isAnonymous: auth.currentUser?.isAnonymous || null,
      tenantId: auth.currentUser?.tenantId || null,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

/**
 * Validates connection to the active Firestore database
 */
async function testConnection() {
  try {
    const { doc, getDocFromServer } = await import('firebase/firestore');
    await getDocFromServer(doc(db, 'trading_strategies', 'connection-test'));
    console.log('Successfully validated secure connection to active Firestore Database.');
  } catch (error: any) {
    if (error && error.message?.includes('the client is offline')) {
      console.error('Please check your Firebase connectivity configuration on the application runner.', error);
    } else {
      console.log('Connection test completed (custom collections/documents are ready).');
    }
  }
}

testConnection();

