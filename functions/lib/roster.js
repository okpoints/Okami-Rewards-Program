const { HttpsError } = require('firebase-functions/v2/https');
const { db, admin } = require('./admin');
const { findCandidates } = require('./nameMatching');
const { logActivity } = require('./activityLog');

async function notifyManagers(message) {
  const managersSnap = await db.collection('users').where('role', 'in', ['manager', 'admin']).get();
  const batch = db.batch();
  managersSnap.docs.forEach((doc) => {
    const notifRef = db.collection('users').doc(doc.id).collection('notifications').doc();
    batch.set(notifRef, { type: 'pendingReview', message, read: false, createdAt: admin.firestore.Timestamp.now() });
  });
  await batch.commit();
}

// A driver signing up types their name; we suggest who they probably are
// on the Cortex roster so the app can ask "are you ___?"
async function findRosterCandidatesLogic(auth, data) {
  if (!auth) throw new HttpsError('unauthenticated', 'You must be signed in.');
  const { enteredName } = data || {};
  if (!enteredName) throw new HttpsError('invalid-argument', 'enteredName is required.');

  const unclaimedSnap = await db.collection('roster').where('linkedUserId', '==', null).get();
  const rosterEntries = unclaimedSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const candidates = findCandidates(enteredName, rosterEntries);

  return { candidates: candidates.map((c) => ({ rosterId: c.transporterId, fullName: c.cortexFullName })) };
}

// The driver's "yes that's me" (or "none of these") only ever creates a
// review for a manager/admin - we never link an account to someone else's
// point history on self-attestation alone, since that would let anyone
// claim someone else's points just by typing their name.
async function requestIdentityLinkLogic(auth, data) {
  if (!auth) throw new HttpsError('unauthenticated', 'You must be signed in.');
  const { rosterId, enteredName } = data || {};
  if (!enteredName) throw new HttpsError('invalid-argument', 'enteredName is required.');

  const reviewRef = db.collection('pendingReview').doc();
  await reviewRef.set({
    type: 'signupIdentityConfirmation',
    userId: auth.uid,
    enteredName,
    suggestedRosterId: rosterId || null,
    status: 'open',
    createdAt: admin.firestore.Timestamp.now(),
  });

  await notifyManagers(
    rosterId
      ? `New signup "${enteredName}" says they're Cortex roster ID ${rosterId} - needs confirmation.`
      : `New signup "${enteredName}" couldn't be matched to anyone on the Cortex roster - needs review.`
  );

  await logActivity({
    actorId: auth.uid,
    actorName: enteredName,
    actorPosition: 'associate',
    action: 'request_identity_link',
    targetType: 'pendingReview',
    targetId: reviewRef.id,
    details: { rosterId },
  });

  return { success: true, reviewId: reviewRef.id };
}

// Manager/admin gives the final approval, linking the driver's account to a
// roster entry and crediting every week of points already sitting on it.
async function resolveIdentityLinkLogic(auth, data, requireRole) {
  const role = requireRole(auth, ['manager', 'admin']);
  const { reviewId, rosterId } = data || {};
  if (!reviewId || !rosterId) {
    throw new HttpsError('invalid-argument', 'reviewId and rosterId are required.');
  }

  const reviewRef = db.collection('pendingReview').doc(reviewId);
  const rosterRef = db.collection('roster').doc(rosterId);

  const ledgerSnap = await rosterRef.collection('ledger').get();
  const totalHistoricalPoints = ledgerSnap.docs.reduce((sum, d) => sum + (d.data().points || 0), 0);

  await db.runTransaction(async (tx) => {
    const [reviewSnap, rosterSnap] = await Promise.all([tx.get(reviewRef), tx.get(rosterRef)]);
    if (!reviewSnap.exists) throw new HttpsError('not-found', 'Review not found.');
    const review = reviewSnap.data();
    if (review.status !== 'open') {
      throw new HttpsError('failed-precondition', 'This has already been resolved by someone else.');
    }
    if (!rosterSnap.exists) throw new HttpsError('not-found', 'Roster entry not found.');
    if (rosterSnap.data().linkedUserId) {
      throw new HttpsError('failed-precondition', 'That roster entry is already linked to another account.');
    }

    tx.update(rosterRef, { linkedUserId: review.userId });
    tx.update(db.collection('users').doc(review.userId), {
      rosterId,
      totalPoints: admin.firestore.FieldValue.increment(totalHistoricalPoints),
    });
    tx.update(reviewRef, {
      status: 'resolved',
      resolvedBy: auth.uid,
      resolvedRosterId: rosterId,
      resolvedAt: admin.firestore.Timestamp.now(),
    });
  });

  await logActivity({
    actorId: auth.uid,
    actorName: auth.token.name || 'Unknown',
    actorPosition: role,
    action: 'resolve_identity_link',
    targetType: 'pendingReview',
    targetId: reviewId,
    details: { rosterId, creditedPoints: totalHistoricalPoints },
  });

  return { success: true, creditedPoints: totalHistoricalPoints };
}

module.exports = { findRosterCandidatesLogic, requestIdentityLinkLogic, resolveIdentityLinkLogic };
