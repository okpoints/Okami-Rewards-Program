const { HttpsError } = require('firebase-functions/v2/https');
const { db, admin } = require('./admin');
const { logActivity } = require('./activityLog');
const { notifyAllAssociates } = require('./notify');

// A simple manager-to-team comment board - no points, no sign-up, no
// approval flow. Just a title/message every associate can see, and
// managers/admins can post or remove.
async function createAnnouncementLogic(auth, data, requireRole) {
  const role = requireRole(auth, ['manager', 'admin']);
  const { title, message } = data || {};
  if (!title || !message) {
    throw new HttpsError('invalid-argument', 'title and message are required.');
  }

  const ref = db.collection('announcements').doc();
  await ref.set({
    title,
    message,
    createdBy: auth.uid,
    createdByName: auth.token.name || 'Unknown',
    createdAt: admin.firestore.Timestamp.now(),
  });

  await notifyAllAssociates('announcement', `New announcement: "${title}"`);

  await logActivity({
    actorId: auth.uid, actorName: auth.token.name || 'Unknown', actorPosition: role,
    action: 'create_announcement', targetType: 'announcements', targetId: ref.id, details: { title },
  });

  return { success: true, announcementId: ref.id };
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

module.exports = { createAnnouncementLogic, deleteAnnouncementLogic };
