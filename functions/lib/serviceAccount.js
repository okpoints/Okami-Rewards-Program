// The Firebase Admin SDK's default service account. Google grants it broad
// Firebase Admin permissions automatically (unlike the default compute/
// App Engine service accounts, which need roles granted by hand) - so we
// run any function that needs elevated Firebase Admin access (setting
// custom claims, reading the Drive folder) as this identity explicitly,
// rather than whatever the platform's default happens to be.
const FIREBASE_ADMIN_SERVICE_ACCOUNT = 'firebase-adminsdk-fbsvc@okami-rewards-program-8e577.iam.gserviceaccount.com';

module.exports = { FIREBASE_ADMIN_SERVICE_ACCOUNT };
