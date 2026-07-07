const { db, admin } = require('./admin');

const THIRTEEN_WEEKS_MS = 1000 * 60 * 60 * 24 * 7 * 13; // ~3 months

// Flags drivers who haven't shown up in a Cortex import in ~3 months so a
// manager/admin can decide whether to deactivate them - this never
// deactivates anyone automatically, turnover-driven guesses are too risky
// to act on without a human looking.
async function scanForInactiveDrivers() {
  const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - THIRTEEN_WEEKS_MS);

  const staleRosterSnap = await db
    .collection('roster')
    .where('active', '==', true)
    .where('updatedAt', '<=', cutoff)
    .get();

  // Skip anyone already flagged - otherwise this would re-notify every day
  // until a manager acts, instead of just once.
  const unflagged = staleRosterSnap.docs.filter((d) => !d.data().inactivityFlaggedAt);
  if (unflagged.length === 0) return { flagged: 0 };

  const managersSnap = await db.collection('users').where('role', 'in', ['manager', 'admin']).get();
  const batch = db.batch();
  let flagged = 0;

  for (const rosterDoc of unflagged) {
    const roster = rosterDoc.data();
    const message = `${roster.cortexFullName} hasn't appeared in a Cortex import since week ${roster.lastSeenWeek} (~3 months) - review for deactivation.`;

    managersSnap.docs.forEach((managerDoc) => {
      const notifRef = db.collection('users').doc(managerDoc.id).collection('notifications').doc();
      batch.set(notifRef, { type: 'inactivityReview', message, read: false, createdAt: admin.firestore.Timestamp.now() });
    });

    // Mark as already-flagged so we don't re-notify every day until someone acts.
    batch.update(rosterDoc.ref, { inactivityFlaggedAt: admin.firestore.Timestamp.now() });
    flagged += 1;
  }

  await batch.commit();
  return { flagged };
}

module.exports = { scanForInactiveDrivers };
