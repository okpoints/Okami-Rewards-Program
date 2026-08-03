const { HttpsError } = require('firebase-functions/v2/https');
const { db, admin } = require('./admin');
const { logActivity } = require('./activityLog');
const { notifyUser, notifyManagers, notifyAllAssociates } = require('./notify');

const URGENCY_LEVELS = ['low', 'medium', 'high', 'critical'];
const SIX_MONTHS_MS = 1000 * 60 * 60 * 24 * 30 * 6;

// A new "Area of Highest Need" post - drivers get notified only for brand
// new posts, never edits (see updateAnnouncementLogic).
async function createAnnouncementLogic(auth, data, requireRole) {
  const role = requireRole(auth, ['manager', 'admin']);
  const { title, description, driversNeeded, pointValue, urgency } = data || {};
  if (!title || !driversNeeded || !pointValue || !urgency) {
    throw new HttpsError('invalid-argument', 'title, driversNeeded, pointValue, and urgency are required.');
  }
  if (!URGENCY_LEVELS.includes(urgency)) {
    throw new HttpsError('invalid-argument', `urgency must be one of: ${URGENCY_LEVELS.join(', ')}`);
  }

  const ref = db.collection('announcements').doc();
  await ref.set({
    title,
    description: description || '',
    driversNeeded,
    pointValue,
    urgency,
    active: true,
    createdBy: auth.uid,
    createdAt: admin.firestore.Timestamp.now(),
  });

  await notifyAllAssociates('announcement', `New need posted: "${title}"`);

  await logActivity({
    actorId: auth.uid, actorName: auth.token.name || 'Unknown', actorPosition: role,
    action: 'create_announcement', targetType: 'announcements', targetId: ref.id, details: { title },
  });

  return { success: true, announcementId: ref.id };
}

async function updateAnnouncementLogic(auth, data, requireRole) {
  const role = requireRole(auth, ['manager', 'admin']);
  const { announcementId, ...updates } = data || {};
  if (!announcementId) throw new HttpsError('invalid-argument', 'announcementId is required.');
  if (updates.urgency && !URGENCY_LEVELS.includes(updates.urgency)) {
    throw new HttpsError('invalid-argument', `urgency must be one of: ${URGENCY_LEVELS.join(', ')}`);
  }

  const ref = db.collection('announcements').doc(announcementId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Announcement not found.');

  await ref.update(updates); // never re-notifies - only a brand-new post does

  await logActivity({
    actorId: auth.uid, actorName: auth.token.name || 'Unknown', actorPosition: role,
    action: 'update_announcement', targetType: 'announcements', targetId: announcementId, details: updates,
  });

  return { success: true };
}

async function deleteAnnouncementLogic(auth, data, requireRole) {
  const role = requireRole(auth, ['manager', 'admin']);
  const { announcementId } = data || {};
  if (!announcementId) throw new HttpsError('invalid-argument', 'announcementId is required.');

  const ref = db.collection('announcements').doc(announcementId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Announcement not found.');

  await ref.delete();

  await logActivity({
    actorId: auth.uid, actorName: auth.token.name || 'Unknown', actorPosition: role,
    action: 'delete_announcement', targetType: 'announcements', targetId: announcementId,
  });

  return { success: true };
}

// A driver enrolls - they only ever see their own status afterward, never
// the real headcount or who else signed up. That's enforced by
// firestore.rules (each driver can only read their own enrollment doc).
async function enrollInAnnouncementLogic(auth, data) {
  if (!auth) throw new HttpsError('unauthenticated', 'You must be signed in.');
  const { announcementId } = data || {};
  if (!announcementId) throw new HttpsError('invalid-argument', 'announcementId is required.');

  const ref = db.collection('announcements').doc(announcementId);
  const snap = await ref.get();
  if (!snap.exists || !snap.data().active) {
    throw new HttpsError('not-found', 'Announcement not found or inactive.');
  }

  await ref.collection('enrollments').doc(auth.uid).set({
    userId: auth.uid, status: 'enrolled', enrolledAt: admin.firestore.Timestamp.now(),
  });

  await notifyManagers('announcement', `${auth.token.name || 'A driver'} signed up for "${snap.data().title}".`);

  await logActivity({
    actorId: auth.uid, actorName: auth.token.name || 'Unknown', actorPosition: 'associate',
    action: 'enroll_announcement', targetType: 'announcements', targetId: announcementId,
  });

  return { success: true };
}

// Manager/admin sees the real enrollment list (drivers never do) and picks
// who's actually confirmed, since not everyone who enrolls follows through.
async function confirmAnnouncementParticipantLogic(auth, data, requireRole) {
  const role = requireRole(auth, ['manager', 'admin']);
  const { announcementId, userId, confirmed } = data || {};
  if (!announcementId || !userId || typeof confirmed !== 'boolean') {
    throw new HttpsError('invalid-argument', 'announcementId, userId, and a boolean confirmed are required.');
  }

  const enrollmentRef = db.collection('announcements').doc(announcementId).collection('enrollments').doc(userId);
  const snap = await enrollmentRef.get();
  if (!snap.exists) throw new HttpsError('not-found', 'This driver never enrolled in this announcement.');

  await enrollmentRef.update({
    status: confirmed ? 'confirmed' : 'not_selected',
    confirmedBy: auth.uid,
    confirmedAt: admin.firestore.Timestamp.now(),
  });

  await notifyUser(
    userId,
    'announcement',
    confirmed
      ? 'You were confirmed for a need you signed up for.'
      : 'You were not selected for a need you signed up for.'
  );

  await logActivity({
    actorId: auth.uid, actorName: auth.token.name || 'Unknown', actorPosition: role,
    action: confirmed ? 'confirm_announcement_participant' : 'reject_announcement_participant',
    targetType: 'announcements', targetId: announcementId, details: { userId },
  });

  return { success: true };
}

// Manager/admin approves completion for a confirmed participant - only now
// are points awarded.
async function resolveAnnouncementCompletionLogic(auth, data, requireRole) {
  const role = requireRole(auth, ['manager', 'admin']);
  const { announcementId, userId, decision } = data || {};
  if (!announcementId || !userId || !['approved', 'denied'].includes(decision)) {
    throw new HttpsError('invalid-argument', 'announcementId, userId, and a valid decision are required.');
  }

  const announcementRef = db.collection('announcements').doc(announcementId);
  const enrollmentRef = announcementRef.collection('enrollments').doc(userId);

  const pointsAwarded = await db.runTransaction(async (tx) => {
    const [announcementSnap, enrollmentSnap] = await Promise.all([tx.get(announcementRef), tx.get(enrollmentRef)]);
    if (!announcementSnap.exists) throw new HttpsError('not-found', 'Announcement not found.');
    if (!enrollmentSnap.exists) throw new HttpsError('not-found', 'This driver never enrolled in this announcement.');
    if (enrollmentSnap.data().status !== 'confirmed') {
      throw new HttpsError('failed-precondition', 'This driver must be confirmed before completion can be resolved.');
    }

    const announcement = announcementSnap.data();
    tx.update(enrollmentRef, {
      status: decision === 'approved' ? 'completed' : 'denied',
      resolvedBy: auth.uid,
      resolvedAt: admin.firestore.Timestamp.now(),
    });

    if (decision === 'approved') {
      tx.update(db.collection('users').doc(userId), {
        totalPoints: admin.firestore.FieldValue.increment(announcement.pointValue),
      });
    }

    return decision === 'approved' ? announcement.pointValue : 0;
  });

  await notifyUser(
    userId,
    'announcement',
    decision === 'approved'
      ? `Your completion was approved - you earned ${pointsAwarded} points.`
      : 'Your completion was not approved.'
  );

  await logActivity({
    actorId: auth.uid, actorName: auth.token.name || 'Unknown', actorPosition: role,
    action: `announcement_completion_${decision}`, targetType: 'announcements', targetId: announcementId,
    details: { userId, pointsAwarded },
  });

  return { success: true, pointsAwarded };
}

// Manager/admin sees the real enrollment list/count - the one place it's
// ever exposed.
async function listAnnouncementEnrollmentsLogic(auth, data, requireRole) {
  requireRole(auth, ['manager', 'admin']);
  const { announcementId } = data || {};
  if (!announcementId) throw new HttpsError('invalid-argument', 'announcementId is required.');

  const snap = await db.collection('announcements').doc(announcementId).collection('enrollments').get();
  return { enrollments: snap.docs.map((d) => ({ userId: d.id, ...d.data() })) };
}

// Paginated history for managers/admins, newest first, covering the last
// 6 months - matches the retention window you asked for. Nothing is
// deleted here (unlike the activity log), just outside the default window.
async function listAnnouncementHistoryLogic(auth, data, requireRole) {
  requireRole(auth, ['manager', 'admin']);
  const { pageSize, startAfterId } = data || {};
  const sixMonthsAgo = admin.firestore.Timestamp.fromMillis(Date.now() - SIX_MONTHS_MS);

  let query = db.collection('announcements')
    .where('createdAt', '>=', sixMonthsAgo)
    .orderBy('createdAt', 'desc')
    .limit(Math.min(pageSize || 20, 100));

  if (startAfterId) {
    const cursorDoc = await db.collection('announcements').doc(startAfterId).get();
    if (cursorDoc.exists) query = query.startAfter(cursorDoc);
  }

  const snap = await query.get();
  return {
    announcements: snap.docs.map((d) => ({ id: d.id, ...d.data() })),
    lastId: snap.docs.length ? snap.docs[snap.docs.length - 1].id : null,
  };
}

// Idempotent - seeds the one preset announcement you gave me so the
// feature isn't empty on first launch. Manager/admin can edit or replace
// it immediately after.
async function seedInitialAnnouncementLogic(auth, data, requireRole) {
  requireRole(auth, ['manager', 'admin']);
  const existing = await db.collection('announcements').limit(1).get();
  if (!existing.empty) {
    throw new HttpsError('failed-precondition', 'An announcement already exists - seed only runs on an empty list.');
  }

  return createAnnouncementLogic(
    auth,
    {
      title: 'Really need people sweeping this week!',
      description: '',
      driversNeeded: 3,
      pointValue: 50,
      urgency: 'high',
    },
    requireRole
  );
}

module.exports = {
  createAnnouncementLogic,
  updateAnnouncementLogic,
  deleteAnnouncementLogic,
  enrollInAnnouncementLogic,
  confirmAnnouncementParticipantLogic,
  resolveAnnouncementCompletionLogic,
  listAnnouncementEnrollmentsLogic,
  listAnnouncementHistoryLogic,
  seedInitialAnnouncementLogic,
};
