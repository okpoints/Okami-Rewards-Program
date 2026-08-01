import { getMessaging, getToken, isSupported } from 'firebase/messaging';
import { doc, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { app, db, firebaseConfig } from './firebase';

export async function isPushSupported() {
  try {
    return await isSupported();
  } catch {
    return false;
  }
}

// iOS Safari only supports web push once the site has been added to the
// Home Screen (iOS 16.4+) - regular browser-tab Safari on iPhone can't do
// it at all, no matter what permission is granted.
export function isIosNonStandalone() {
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  return isIos && !isStandalone;
}

async function registerServiceWorker() {
  const params = new URLSearchParams(firebaseConfig);
  return navigator.serviceWorker.register(`/firebase-messaging-sw.js?${params.toString()}`);
}

export async function enablePushForThisDevice(userId) {
  if (!(await isPushSupported())) {
    throw new Error('Push notifications are not supported in this browser.');
  }
  const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
  if (!vapidKey) {
    throw new Error('Push notifications are not configured for this app yet.');
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Notification permission was not granted.');
  }

  const registration = await registerServiceWorker();
  const messaging = getMessaging(app);
  const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
  if (!token) {
    throw new Error('Could not register this device for push notifications - try again.');
  }

  await updateDoc(doc(db, 'users', userId), { fcmTokens: arrayUnion(token) });
  return token;
}

export async function disablePushForThisDevice(userId) {
  if (!(await isPushSupported())) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return;
    const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
    const messaging = getMessaging(app);
    const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
    if (token) {
      await updateDoc(doc(db, 'users', userId), { fcmTokens: arrayRemove(token) });
    }
  } catch {
    // Best-effort - if this fails the token just sits unused until FCM
    // eventually reports it as stale and the backend prunes it.
  }
}
