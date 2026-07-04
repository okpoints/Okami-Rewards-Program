const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { db, admin } = require('./lib/admin');
const { syncCortexFile } = require('./lib/driveSync');
const { logActivity } = require('./lib/activityLog');
const { requireRole } = require('./lib/roles');

// Must have Viewer access to the "Okami Rewards Program" Drive folder.
const DRIVE_SERVICE_ACCOUNT = 'firebase-adminsdk-fbsvc@okami-rewards-program-8e577.iam.gserviceaccount.com';

exports.weeklyCortexSync = onSchedule(
  {
    schedule: 'every monday 06:00',
    timeZone: 'America/New_York',
    serviceAccount: DRIVE_SERVICE_ACCOUNT,
  },
  async () => {
    const result = await syncCortexFile();
    console.log('Cortex sync result:', result);
  }
);

// Manager/admin resolves a name the weekly sync couldn't confidently match.
// First resolver wins - a second attempt on the same review is rejected.
exports.resolvePendingReview = onCall(async (request) => {
  const role = requireRole(request.auth, ['manager', 'admin']);
  const { reviewId, resolvedUserId } = request.data;
  if (!reviewId || !resolvedUserId) {
    throw new HttpsError('invalid-argument', 'reviewId and resolvedUserId are required.');
  }

  const reviewRef = db.collection('pendingReview').doc(reviewId);

  await db.runTransaction(async (tx) => {
    const reviewSnap = await tx.get(reviewRef);
    if (!reviewSnap.exists) {
      throw new HttpsError('not-found', 'Review not found.');
    }
    const review = reviewSnap.data();
    if (review.status !== 'open') {
      throw new HttpsError('failed-precondition', 'This has already been resolved by someone else.');
    }

    const userRef = db.collection('users').doc(resolvedUserId);
    const ledgerRef = userRef.collection('pointsLedger').doc(review.week);

    tx.set(ledgerRef, {
      week: review.week,
      points: review.score,
      standing: review.standing,
      source: 'cortex-sync-resolved',
      rawName: review.rawName,
      createdAt: admin.firestore.Timestamp.now(),
    });
    tx.update(userRef, { totalPoints: admin.firestore.FieldValue.increment(review.score) });
    tx.update(reviewRef, {
      status: 'resolved',
      resolvedBy: request.auth.uid,
      resolvedUserId,
      resolvedAt: admin.firestore.Timestamp.now(),
    });
  });

  await logActivity({
    actorId: request.auth.uid,
    actorName: request.auth.token.name || 'Unknown',
    actorPosition: role,
    action: 'resolve_pending_review',
    targetType: 'pendingReview',
    targetId: reviewId,
    details: { resolvedUserId },
  });

  return { success: true };
});

// An associate spends points on a reward. This only ever creates a pending
// request - approval/rejection happens in resolveRedemption below.
exports.requestRedemption = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in.');
  }
  const { rewardId } = request.data;
  if (!rewardId) {
    throw new HttpsError('invalid-argument', 'rewardId is required.');
  }

  const userRef = db.collection('users').doc(request.auth.uid);
  const rewardRef = db.collection('rewards').doc(rewardId);
  const requestRef = db.collection('redemptionRequests').doc();

  await db.runTransaction(async (tx) => {
    const [userSnap, rewardSnap] = await Promise.all([tx.get(userRef), tx.get(rewardRef)]);
    if (!rewardSnap.exists || !rewardSnap.data().active) {
      throw new HttpsError('not-found', 'Reward not found or inactive.');
    }
    const user = userSnap.data();
    const reward = rewardSnap.data();
    if ((user.totalPoints || 0) < reward.pointCost) {
      throw new HttpsError('failed-precondition', 'Not enough points for this reward.');
    }

    tx.set(requestRef, {
      userId: request.auth.uid,
      rewardId,
      rewardName: reward.name,
      pointCost: reward.pointCost,
      status: 'pending',
      requestedAt: admin.firestore.Timestamp.now(),
    });
  });

  await logActivity({
    actorId: request.auth.uid,
    actorName: request.auth.token.name || 'Unknown',
    actorPosition: 'associate',
    action: 'request_redemption',
    targetType: 'redemptionRequests',
    targetId: requestRef.id,
    details: { rewardId },
  });

  return { success: true, requestId: requestRef.id };
});

// Manager/admin approves or rejects a redemption request. Points are only
// deducted on approval.
exports.resolveRedemption = onCall(async (request) => {
  const role = requireRole(request.auth, ['manager', 'admin']);
  const { requestId, decision } = request.data;
  if (!requestId || !['approved', 'rejected'].includes(decision)) {
    throw new HttpsError('invalid-argument', 'requestId and a valid decision are required.');
  }

  const requestRef = db.collection('redemptionRequests').doc(requestId);

  await db.runTransaction(async (tx) => {
    const reqSnap = await tx.get(requestRef);
    if (!reqSnap.exists) {
      throw new HttpsError('not-found', 'Redemption request not found.');
    }
    const reqData = reqSnap.data();
    if (reqData.status !== 'pending') {
      throw new HttpsError('failed-precondition', 'This request has already been resolved.');
    }

    if (decision === 'approved') {
      const userRef = db.collection('users').doc(reqData.userId);
      tx.update(userRef, { totalPoints: admin.firestore.FieldValue.increment(-reqData.pointCost) });
    }

    tx.update(requestRef, {
      status: decision,
      resolvedBy: request.auth.uid,
      resolvedAt: admin.firestore.Timestamp.now(),
    });
  });

  await logActivity({
    actorId: request.auth.uid,
    actorName: request.auth.token.name || 'Unknown',
    actorPosition: role,
    action: `redemption_${decision}`,
    targetType: 'redemptionRequests',
    targetId: requestId,
  });

  return { success: true };
});

// Hard-deletes activity log entries older than 1 year (they're already
// hidden from the default UI view after 6 months on the client side).
exports.cleanupActivityLog = onSchedule('every day 03:00', async () => {
  const now = admin.firestore.Timestamp.now();
  const snap = await db.collection('activityLog').where('purgeAfter', '<=', now).limit(500).get();
  if (snap.empty) return;
  const batch = db.batch();
  snap.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
  console.log(`Purged ${snap.docs.length} activity log entries older than 1 year.`);
});
