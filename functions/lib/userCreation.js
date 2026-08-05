const crypto = require('crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { db, admin } = require('./admin');
const { logActivity } = require('./activityLog');

// Admin can create any of the three roles directly, including admin itself
// - granting admin power is still gated to admins only (checked below), so
// this doesn't open a new path around that. A manager (even one delegated
// createUserAccounts) can only ever create associate/manager - creating an
// admin account is equivalent to a role promotion, and a delegated manager
// was never allowed to do that (see setUserRoleLogic, admin-only).
const CREATABLE_ROLES = ['associate', 'manager', 'admin'];
const MANAGER_CREATABLE_ROLES = ['associate', 'manager'];

// Admin-initiated account creation for someone who hasn't signed up
// themselves yet (e.g. onboarding a new hire before they've set anything
// up). Delegable to managers via the createUserAccounts permission, same
// pattern as viewActivityLog.
async function createUserAccountLogic(auth, data, requireRole) {
  const role = requireRole(auth, ['admin', 'manager']);
  const { email, fullName, role: targetRole } = data || {};
  if (!email || !fullName || !CREATABLE_ROLES.includes(targetRole)) {
    throw new HttpsError('invalid-argument', `email, fullName, and a role (one of ${CREATABLE_ROLES.join(', ')}) are required.`);
  }

  if (role === 'manager') {
    if (!MANAGER_CREATABLE_ROLES.includes(targetRole)) {
      throw new HttpsError('permission-denied', 'Only an admin can create an admin account.');
    }
    const callerSnap = await db.collection('users').doc(auth.uid).get();
    if (!callerSnap.data()?.permissions?.createUserAccounts) {
      throw new HttpsError('permission-denied', 'You have not been granted permission to create user accounts.');
    }
  }

  // Never exposed or transmitted anywhere - the account holder sets their
  // own password via the reset-password email the client sends right
  // after this succeeds, same flow as "Forgot password?".
  const temporaryPassword = crypto.randomBytes(24).toString('base64url');

  let userRecord;
  try {
    userRecord = await admin.auth().createUser({
      email,
      password: temporaryPassword,
      displayName: fullName,
    });
  } catch (err) {
    if (err.code === 'auth/email-already-exists') {
      throw new HttpsError('already-exists', 'An account with this email already exists.');
    }
    throw new HttpsError('internal', err.message);
  }

  await admin.auth().setCustomUserClaims(userRecord.uid, { role: targetRole });

  // An associate account created this way (no Cortex history yet) still
  // gets a roster entry, auto-linked immediately - same as if a manager
  // had added them to the roster by hand first, just skipping that step -
  // so they show up in the Roster card for supervision like everyone else.
  let rosterId = null;
  if (targetRole === 'associate') {
    const rosterRef = db.collection('roster').doc();
    await rosterRef.set({
      transporterId: null,
      cortexFullName: fullName.trim(),
      aliases: [],
      source: 'manual',
      linkedUserId: userRecord.uid,
      linkedAt: admin.firestore.Timestamp.now(),
      active: true,
      lastSeenWeek: null,
      createdAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
    });
    rosterId = rosterRef.id;
  }

  await db.collection('users').doc(userRecord.uid).set({
    email,
    fullName,
    role: targetRole,
    totalPoints: 0,
    status: 'active',
    createdAt: admin.firestore.Timestamp.now(),
    createdBy: auth.uid,
    ...(rosterId ? { rosterId } : {}),
  });

  await logActivity({
    actorId: auth.uid,
    actorName: auth.token.name || 'Unknown',
    actorPosition: role,
    action: 'create_user_account',
    targetType: 'users',
    targetId: userRecord.uid,
    details: { email, fullName, role: targetRole },
  });

  return { success: true, uid: userRecord.uid };
}

module.exports = { createUserAccountLogic };
