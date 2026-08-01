const { HttpsError } = require('firebase-functions/v2/https');
const { db, admin } = require('./admin');
const { logActivity } = require('./activityLog');
const { notifyUser } = require('./notify');

const VALID_ROLES = ['associate', 'manager', 'admin'];

// Promoting/demoting someone's role (employee -> manager -> admin, or back
// down) is admin-exclusive and never delegable - unlike the individual
// manager permissions in permissions.js, which an admin can delegate the
// power to manage. Handing out the role itself is a bigger lever than any
// single permission, so it stays admin-only, full stop.
async function setUserRoleLogic(auth, data, requireRole) {
  requireRole(auth, ['admin']);
  const { userId, role } = data || {};
  if (!userId || !VALID_ROLES.includes(role)) {
    throw new HttpsError('invalid-argument', `userId and a role (one of ${VALID_ROLES.join(', ')}) are required.`);
  }
  if (userId === auth.uid) {
    throw new HttpsError('permission-denied', 'You cannot change your own role.');
  }

  const userRef = db.collection('users').doc(userId);
  const userSnap = await userRef.get();
  if (!userSnap.exists) throw new HttpsError('not-found', 'User not found.');
  const previousRole = userSnap.data().role;

  await admin.auth().setCustomUserClaims(userId, { role });

  const updates = { role };
  if (role !== 'manager') {
    // Delegated manager permissions don't carry over off the manager role -
    // an ex-manager or a freshly-promoted admin (who already has everything)
    // shouldn't keep a stale permissions map hanging around.
    updates.permissions = admin.firestore.FieldValue.delete();
  }
  await userRef.update(updates);

  await notifyUser(userId, 'roleChange', `Your account role was changed to ${role}. Log out and back in to see the change take effect.`);

  await logActivity({
    actorId: auth.uid,
    actorName: auth.token.name || 'Unknown',
    actorPosition: 'admin',
    action: 'change_user_role',
    targetType: 'users',
    targetId: userId,
    details: { previousRole, newRole: role },
  });

  return { success: true };
}

module.exports = { setUserRoleLogic };
