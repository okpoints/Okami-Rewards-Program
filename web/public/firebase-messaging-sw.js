/* eslint-disable no-undef */
// Handles push notifications while the app isn't in focus (tab closed,
// phone locked, etc). Firebase config can't come from import.meta.env
// here - a service worker isn't part of the Vite build - so the client
// passes it via the registration URL's query string instead
// (see pushNotifications.js), and we read it back out below.

importScripts('https://www.gstatic.com/firebasejs/12.7.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.7.0/firebase-messaging-compat.js');

const params = new URLSearchParams(self.location.search);
const firebaseConfig = {
  apiKey: params.get('apiKey'),
  authDomain: params.get('authDomain'),
  projectId: params.get('projectId'),
  storageBucket: params.get('storageBucket'),
  messagingSenderId: params.get('messagingSenderId'),
  appId: params.get('appId'),
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || 'Okami Rewards';
  const body = payload.notification?.body || '';
  self.registration.showNotification(title, {
    body,
    icon: '/favicon.svg',
  });
});
