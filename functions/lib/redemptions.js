const { HttpsError } = require('firebase-functions/v2/https');
const { db, admin } = require('./admin');
const { logActivity } = require('./activityLog');
const { requireRole } = require('./roles');

// An associate spends points on a reward. This only ever creates a pending
// request - approval/rejection happens in resolveRedemptionLogic below.
async function requestRedemptionLogic(auth, data) {
  if (!auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in.');
  }
  const { rewardId } = data || {};
  if (!rewardId) {
    throw new HttpsError('invalid-argument', 'rewardId is required.');
  }

  const userRef = db.collection('users').doc(auth.uid);
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
      userId: auth.uid,
      rewardId,
      rewardName: reward.name,
      pointCost: reward.pointCost,
      status: 'pending',
      requestedAt: admin.firestore.Timestamp.now(),
    });
  });

  await logActivity({
    actorId: auth.uid,
    actorName: auth.token.name || 'Unknown',
    actorPosition: 'associate',
    action: 'request_redemption',
    targetType: 'redemptionRequests',
    targetId: requestRef.id,
    details: { rewardId },
  });

  return { success: true, requestId: requestRef.id };
}

// Manager/admin approves or rejects a redemption request. Points are only
// deducted on approval.
async function resolveRedemptionLogic(auth, data) {
  const role = requireRole(auth, ['manager', 'admin']);
  const { requestId, decision } = data || {};
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
      resolvedBy: auth.uid,
      resolvedAt: admin.firestore.Timestamp.now(),
    });
  });

  await logActivity({
    actorId: auth.uid,
    actorName: auth.token.name || 'Unknown',
    actorPosition: role,
    action: `redemption_${decision}`,
    targetType: 'redemptionRequests',
    targetId: requestId,
  });

  return { success: true };
}

module.exports = { requestRedemptionLogic, resolveRedemptionLogic };
