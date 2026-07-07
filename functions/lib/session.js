const { HttpsError } = require('firebase-functions/v2/https');
const { db, admin } = require('./admin');

// The frontend calls this right after a successful sign-in so managers can
// see "last time they logged in" on the roster view. Firebase Auth tracks
// this internally too, but not in a form a manager-facing list can easily
// query, so we mirror it onto the Firestore user doc.
async function recordLoginLogic(auth) {
  if (!auth) throw new HttpsError('unauthenticated', 'You must be signed in.');
  await db.collection('users').doc(auth.uid).update({ lastLoginAt: admin.firestore.Timestamp.now() });
  return { success: true };
}

module.exports = { recordLoginLogic };
