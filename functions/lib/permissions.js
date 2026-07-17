const { HttpsError } = require('firebase-functions/v2/https');
const { db, admin } = require('./admin');
const { logActivity } = require('./activityLog');

// Extensible - add new permission names here as they get defined (e.g.
// editDriverAccounts, adjustPointBalances, viewManagerActivityLogs).
const KNOWN_PERMISSIONS = ['viewActivityLog', 'manageManagerPermissions'];

// This one is admin-exclusive - a manager who's been delegated the power
// to manage other managers' permissions still can't hand that same power
// to someone else. Otherwise it could cascade out of admin control.
const ADMIN_ONLY_PERMISSIONS = ['manageManagerPermissions'];

// Admins can always grant/revoke any known permission on a manager's
// account. A manager who's been granted manageManagerPermissions can also
// grant/revoke ordinary permissions (like viewActivityLog) on OTHER
// managers - but never the delegation permission itself, and never on
// their own account.
async function setManagerPermissionLogic(auth, data, requireRole) {
  const role = requireRole(auth, ['admin', 'manager']);
  const { managerId, permission, enabled } = data || {};
  if (!managerId || !permission || typeof enabled !== 'boolean') {
    throw new HttpsError('invalid-argument', 'managerId, permission, and a boolean enabled are required.');
  }
  if (!KNOWN_PERMISSIONS.includes(permission)) {
    throw new HttpsError('invalid-argument', `Unknown permission: ${permission}`);
  }

  if (role === 'manager') {
    if (managerId === auth.uid) {
      throw new HttpsError('permission-denied', 'You cannot change your own permissions.');
    }
    if (ADMIN_ONLY_PERMISSIONS.includes(permission)) {
      throw new HttpsError('permission-denied', 'Only an admin can grant or revoke this permission.');
    }
    const callerSnap = await db.collection('users').doc(auth.uid).get();
    if (!callerSnap.data()?.permissions?.manageManagerPermissions) {
      throw new HttpsError('permission-denied', 'You have not been granted permission to manage other managers.');
    }
  }

  const managerRef = db.collection('users').doc(managerId);
  const managerSnap = await managerRef.get();
  if (!managerSnap.exists) throw new HttpsError('not-found', 'Manager account not found.');
  if (managerSnap.data().role !== 'manager') {
    throw new HttpsError('failed-precondition', 'This permission toggle only applies to manager accounts.');
  }

  await managerRef.update({ [`permissions.${permission}`]: enabled });

  await logActivity({
    actorId: auth.uid,
    actorName: auth.token.name || 'Unknown',
    actorPosition: role,
    action: enabled ? 'grant_permission' : 'revoke_permission',
    targetType: 'users',
    targetId: managerId,
    details: { permission },
  });

  return { success: true };
}

module.exports = { setManagerPermissionLogic, KNOWN_PERMISSIONS };
