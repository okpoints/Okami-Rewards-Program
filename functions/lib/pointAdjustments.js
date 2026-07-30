const { HttpsError } = require('firebase-functions/v2/https');
const { db, admin } = require('./admin');
const { logActivity } = require('./activityLog');

// Manual point add/deduct for manager/admin - the stand-in for negative
// point events (no-call/no-show, tardiness) until the messy Okami sheets
// can be parsed automatically. A reason is required so there's always an
// explanation attached, not just a number changing.
async function adjustPointsLogic(auth, data, requireRole) {
  const role = requireRole(auth, ['manager', 'admin']);
  const { userId, delta, reason } = data || {};
  if (!userId || typeof delta !== 'number' || delta === 0 || Number.isNaN(delta)) {
    throw new HttpsError('invalid-argument', 'userId and a nonzero numeric delta are required.');
  }
  if (!reason || !reason.trim()) {
    throw new HttpsError('invalid-argument', 'A reason is required for manual point adjustments.');
  }

  const userRef = db.collection('users').doc(userId);
  const userSnap = await userRef.get();
  if (!userSnap.exists) throw new HttpsError('not-found', 'User not found.');

  const adjustmentRef = db.collection('pointAdjustments').doc();
  await adjustmentRef.set({
    userId,
    delta,
    reason: reason.trim(),
    adjustedBy: auth.uid,
    createdAt: admin.firestore.Timestamp.now(),
  });

  await userRef.update({
    totalPoints: admin.firestore.FieldValue.increment(delta),
    ...(delta < 0 ? { deductionCount: admin.firestore.FieldValue.increment(1) } : {}),
  });

  await logActivity({
    actorId: auth.uid,
    actorName: auth.token.name || 'Unknown',
    actorPosition: role,
    action: delta > 0 ? 'manual_point_credit' : 'manual_point_deduction',
    targetType: 'pointAdjustments',
    targetId: adjustmentRef.id,
    details: { userId, delta, reason: reason.trim() },
  });

  await db.collection('users').doc(userId).collection('notifications').add({
    type: 'pointAdjustment',
    message: delta > 0
      ? `You were credited ${delta} points: ${reason.trim()}`
      : `You were deducted ${Math.abs(delta)} points: ${reason.trim()}`,
    read: false,
    createdAt: admin.firestore.Timestamp.now(),
  });

  return { success: true };
}

module.exports = { adjustPointsLogic };
