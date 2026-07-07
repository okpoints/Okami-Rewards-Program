const { HttpsError } = require('firebase-functions/v2/https');
const { db, admin } = require('./admin');
const { logActivity } = require('./activityLog');

const URGENCY_LEVELS = ['low', 'medium', 'high', 'very_high'];

async function notifyManagers(message) {
  const managersSnap = await db.collection('users').where('role', 'in', ['manager', 'admin']).get();
  const batch = db.batch();
  managersSnap.docs.forEach((doc) => {
    const notifRef = db.collection('users').doc(doc.id).collection('notifications').doc();
    batch.set(notifRef, { type: 'bonusTask', message, read: false, createdAt: admin.firestore.Timestamp.now() });
  });
  await batch.commit();
}

async function notifyUser(userId, message) {
  await db.collection('users').doc(userId).collection('notifications').add({
    type: 'bonusTask', message, read: false, createdAt: admin.firestore.Timestamp.now(),
  });
}

// Manager/admin authors a standing task drivers can browse and enroll in
// anytime (Rescue, Pick up a shift, Train a new employee, Sweep vans, or
// anything custom they add). This is the "temporary scoreboard" -
// structured points tracking that doesn't depend on the messy Okami sheets.
async function createBonusTaskLogic(auth, data, requireRole) {
  const role = requireRole(auth, ['manager', 'admin']);
  const { title, description, urgency, openings, pointValue } = data || {};
  if (!title || !urgency || !openings || !pointValue) {
    throw new HttpsError('invalid-argument', 'title, urgency, openings, and pointValue are required.');
  }
  if (!URGENCY_LEVELS.includes(urgency)) {
    throw new HttpsError('invalid-argument', `urgency must be one of: ${URGENCY_LEVELS.join(', ')}`);
  }

  const taskRef = db.collection('bonusTasks').doc();
  await taskRef.set({
    title,
    description: description || '',
    urgency,
    openings,
    pointValue,
    active: true,
    createdBy: auth.uid,
    createdAt: admin.firestore.Timestamp.now(),
  });

  await logActivity({
    actorId: auth.uid, actorName: auth.token.name || 'Unknown', actorPosition: role,
    action: 'create_bonus_task', targetType: 'bonusTasks', targetId: taskRef.id, details: { title },
  });

  return { success: true, taskId: taskRef.id };
}

async function updateBonusTaskLogic(auth, data, requireRole) {
  const role = requireRole(auth, ['manager', 'admin']);
  const { taskId, ...updates } = data || {};
  if (!taskId) throw new HttpsError('invalid-argument', 'taskId is required.');
  if (updates.urgency && !URGENCY_LEVELS.includes(updates.urgency)) {
    throw new HttpsError('invalid-argument', `urgency must be one of: ${URGENCY_LEVELS.join(', ')}`);
  }

  const taskRef = db.collection('bonusTasks').doc(taskId);
  const taskSnap = await taskRef.get();
  if (!taskSnap.exists) throw new HttpsError('not-found', 'Bonus task not found.');

  await taskRef.update(updates);

  await logActivity({
    actorId: auth.uid, actorName: auth.token.name || 'Unknown', actorPosition: role,
    action: 'update_bonus_task', targetType: 'bonusTasks', targetId: taskId, details: updates,
  });

  return { success: true };
}

async function deleteBonusTaskLogic(auth, data, requireRole) {
  const role = requireRole(auth, ['manager', 'admin']);
  const { taskId } = data || {};
  if (!taskId) throw new HttpsError('invalid-argument', 'taskId is required.');

  const taskRef = db.collection('bonusTasks').doc(taskId);
  const taskSnap = await taskRef.get();
  if (!taskSnap.exists) throw new HttpsError('not-found', 'Bonus task not found.');

  await taskRef.delete();

  await logActivity({
    actorId: auth.uid, actorName: auth.token.name || 'Unknown', actorPosition: role,
    action: 'delete_bonus_task', targetType: 'bonusTasks', targetId: taskId,
  });

  return { success: true };
}

// A driver enrolls - this alone never awards points, only a later manager
// approval of completion does.
async function enrollInBonusTaskLogic(auth, data) {
  if (!auth) throw new HttpsError('unauthenticated', 'You must be signed in.');
  const { taskId } = data || {};
  if (!taskId) throw new HttpsError('invalid-argument', 'taskId is required.');

  const taskRef = db.collection('bonusTasks').doc(taskId);
  const taskSnap = await taskRef.get();
  if (!taskSnap.exists || !taskSnap.data().active) {
    throw new HttpsError('not-found', 'Bonus task not found or inactive.');
  }

  const enrollmentRef = taskRef.collection('enrollments').doc(auth.uid);
  await enrollmentRef.set({
    userId: auth.uid,
    status: 'enrolled',
    enrolledAt: admin.firestore.Timestamp.now(),
  });

  await notifyManagers(`${auth.token.name || 'A driver'} enrolled in bonus task "${taskSnap.data().title}".`);

  await logActivity({
    actorId: auth.uid, actorName: auth.token.name || 'Unknown', actorPosition: 'associate',
    action: 'enroll_bonus_task', targetType: 'bonusTasks', targetId: taskId,
  });

  return { success: true };
}

// Manager/admin approves (or denies) a specific driver's completion.
// Points are only ever awarded here, never on enrollment.
async function resolveBonusTaskLogic(auth, data, requireRole) {
  const role = requireRole(auth, ['manager', 'admin']);
  const { taskId, userId, decision } = data || {};
  if (!taskId || !userId || !['approved', 'denied'].includes(decision)) {
    throw new HttpsError('invalid-argument', 'taskId, userId, and a valid decision are required.');
  }

  const taskRef = db.collection('bonusTasks').doc(taskId);
  const enrollmentRef = taskRef.collection('enrollments').doc(userId);

  const pointsAwarded = await db.runTransaction(async (tx) => {
    const [taskSnap, enrollmentSnap] = await Promise.all([tx.get(taskRef), tx.get(enrollmentRef)]);
    if (!taskSnap.exists) throw new HttpsError('not-found', 'Bonus task not found.');
    if (!enrollmentSnap.exists) throw new HttpsError('not-found', 'This driver never enrolled in this task.');
    if (enrollmentSnap.data().status !== 'enrolled') {
      throw new HttpsError('failed-precondition', 'This enrollment has already been resolved.');
    }

    const task = taskSnap.data();
    tx.update(enrollmentRef, {
      status: decision === 'approved' ? 'completed' : 'denied',
      resolvedBy: auth.uid,
      resolvedAt: admin.firestore.Timestamp.now(),
    });

    if (decision === 'approved') {
      tx.update(db.collection('users').doc(userId), {
        totalPoints: admin.firestore.FieldValue.increment(task.pointValue),
      });
    }

    return decision === 'approved' ? task.pointValue : 0;
  });

  await notifyUser(
    userId,
    decision === 'approved'
      ? `Your bonus task completion was approved - you earned ${pointsAwarded} points.`
      : 'Your bonus task completion was not approved.'
  );

  await logActivity({
    actorId: auth.uid, actorName: auth.token.name || 'Unknown', actorPosition: role,
    action: `bonus_task_${decision}`, targetType: 'bonusTasks', targetId: taskId,
    details: { userId, pointsAwarded },
  });

  return { success: true, pointsAwarded };
}

module.exports = {
  createBonusTaskLogic,
  updateBonusTaskLogic,
  deleteBonusTaskLogic,
  enrollInBonusTaskLogic,
  resolveBonusTaskLogic,
};
