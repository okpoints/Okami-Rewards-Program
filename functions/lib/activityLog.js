const { db, admin } = require('./admin');

// Every write in this app is expected to call this so managers/admins have
// a full audit trail of who did what. Nothing is ever hard-deleted -
// entries just drop out of the default 1-year search window (see
// queryActivityLogLogic), and an admin can still pull them up by including
// hidden entries in the search when they actually need to.
async function logActivity({ actorId, actorName, actorPosition, action, targetType, targetId, details }) {
  return db.collection('activityLog').add({
    actorId,
    actorName,
    actorPosition,
    action,
    targetType,
    targetId,
    details: details || null,
    createdAt: admin.firestore.Timestamp.now(),
  });
}

module.exports = { logActivity };
