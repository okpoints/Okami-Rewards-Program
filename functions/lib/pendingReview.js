const { HttpsError } = require('firebase-functions/v2/https');
const { db, admin } = require('./admin');
const { logActivity } = require('./activityLog');
const { requireRole } = require('./roles');

// Manager/admin resolves a name the weekly sync couldn't confidently match.
// First resolver wins - a second attempt on the same review is rejected.
async function resolvePendingReviewLogic(auth, data) {
  const role = requireRole(auth, ['manager', 'admin']);
  const { reviewId, resolvedUserId } = data || {};
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
      resolvedBy: auth.uid,
      resolvedUserId,
      resolvedAt: admin.firestore.Timestamp.now(),
    });
  });

  await logActivity({
    actorId: auth.uid,
    actorName: auth.token.name || 'Unknown',
    actorPosition: role,
    action: 'resolve_pending_review',
    targetType: 'pendingReview',
    targetId: reviewId,
    details: { resolvedUserId },
  });

  return { success: true };
}

module.exports = { resolvePendingReviewLogic };
