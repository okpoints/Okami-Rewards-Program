const functionsV1 = require('firebase-functions/v1');
const { db, admin } = require('./admin');
const { getBootstrapAdmin } = require('./adminAllowlist');
const { logActivity } = require('./activityLog');

// Fires right after someone creates an account on the login page.
// The two hardcoded bootstrap admins get the admin role automatically;
// everyone else starts as a plain associate until a Manager/Admin account
// promotes them (that promotion flow is a separate, not-yet-built function).
async function handleUserCreate(user) {
  const bootstrapAdmin = getBootstrapAdmin(user.email);
  const role = bootstrapAdmin ? 'admin' : 'associate';
  const fullName = bootstrapAdmin ? bootstrapAdmin.fullName : (user.displayName || '');

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

const onUserCreate = functionsV1.auth.user().onCreate(handleUserCreate);

module.exports = { onUserCreate, handleUserCreate };
