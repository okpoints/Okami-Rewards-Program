const { db, admin } = require('./admin');

const SIX_MONTHS_MS = 1000 * 60 * 60 * 24 * 30 * 6;
const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;

// Every write in this app is expected to call this so managers/admins have
// a full audit trail of who did what. Entries are hidden from the default
// view after 6 months and hard-deleted after 1 year (see cleanupActivityLog).
async function logActivity({ actorId, actorName, actorPosition, action, targetType, targetId, details }) {
  const now = admin.firestore.Timestamp.now();
  return db.collection('activityLog').add({
    actorId,
    actorName,
    actorPosition,
    action,
    targetType,
    targetId,
    details: details || null,
    createdAt: now,
    hiddenAfter: admin.firestore.Timestamp.fromMillis(now.toMillis() + SIX_MONTHS_MS),
    purgeAfter: admin.firestore.Timestamp.fromMillis(now.toMillis() + ONE_YEAR_MS),
  });
}

module.exports = { logActivity };
