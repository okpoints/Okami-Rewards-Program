const functionsV1 = require('firebase-functions/v1');
const { db, admin } = require('./admin');
const { getBootstrapRole } = require('./roleAllowlist');
const { logActivity } = require('./activityLog');
const { FIREBASE_ADMIN_SERVICE_ACCOUNT } = require('./serviceAccount');

// Fires right after someone creates an account on the login page.
// Bootstrap admins/managers get their role automatically; everyone else
// starts as a plain associate. Associates then go through the roster
// identity-confirmation flow (see roster.js) to link their Cortex point
// history - this trigger just creates the bare account.
async function handleUserCreate(user) {
  const bootstrap = getBootstrapRole(user.email);
  const role = bootstrap ? bootstrap.role : 'associate';
  const fullName = bootstrap ? bootstrap.fullName : (user.displayName || '');

  await admin.auth().setCustomUserClaims(user.uid, { role });

  await db.collection('users').doc(user.uid).set({
    email: user.email,
    fullName,
    role,
    totalPoints: 0,
    status: 'active',
    createdAt: admin.firestore.Timestamp.now(),
  });

  await logActivity({
    actorId: 'system',
    actorName: 'Account Signup',
    actorPosition: 'system',
    action: 'account_created',
    targetType: 'users',
    targetId: user.uid,
    details: { email: user.email, role },
  });
}

// setCustomUserClaims needs Firebase Auth Admin permissions the default
// runtime identity doesn't have - run this as the Firebase Admin SDK
// service account instead, which already has them.
const onUserCreate = functionsV1
  .runWith({ serviceAccount: FIREBASE_ADMIN_SERVICE_ACCOUNT })
  .auth.user()
  .onCreate(handleUserCreate);

module.exports = { onUserCreate, handleUserCreate };
