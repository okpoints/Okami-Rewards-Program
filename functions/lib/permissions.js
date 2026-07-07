const { HttpsError } = require('firebase-functions/v2/https');
const { db, admin } = require('./admin');
const { logActivity } = require('./activityLog');

// Extensible - add new permission names here as they get defined (e.g.
// editDriverAccounts, adjustPointBalances, viewManagerActivityLogs).
const KNOWN_PERMISSIONS = ['viewActivityLog'];

// Admin grants/revokes a specific optional permission on a manager's
// account. Only admins can do this for now - see open question about
// whether managers should ever be able to delegate this to other managers.
async function setManagerPermissionLogic(auth, data, requireRole) {
  const role = requireRole(auth, ['admin']);
  const { managerId, permission, enabled } = data || {};
  if (!managerId || !permission || typeof enabled !== 'boolean') {
    throw new HttpsError('invalid-argument', 'managerId, permission, and a boolean enabled are required.');
  }
  if (!KNOWN_PERMISSIONS.includes(permission)) {
    throw new HttpsError('invalid-argument', `Unknown permission: ${permission}`);
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
