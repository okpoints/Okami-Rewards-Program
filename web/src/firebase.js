import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';

// These values come from Firebase Console -> Project settings -> General ->
// "Your apps" -> Web app -> SDK setup and configuration. They're safe to
// expose in frontend code (unlike a service account key) - they just tell
// the browser which Firebase project to talk to, they don't grant access
// on their own. Real values go in web/.env (see web/.env.example).
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// TEMPORARY - just to debug why the API key is being rejected. Remove
// once we confirm the real config is loading correctly.
console.log('Firebase config the app is actually using:', {
  ...firebaseConfig,
  apiKey: firebaseConfig.apiKey ? `${firebaseConfig.apiKey.slice(0, 8)}... (length ${firebaseConfig.apiKey.length})` : firebaseConfig.apiKey,
});

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app);
