const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall } = require('firebase-functions/v2/https');
const { db, admin } = require('./lib/admin');
const { syncCortexFile } = require('./lib/driveSync');
const { onUserCreate } = require('./lib/authTriggers');
const { resolvePendingReviewLogic } = require('./lib/pendingReview');
const { requestRedemptionLogic, resolveRedemptionLogic } = require('./lib/redemptions');

exports.onUserCreate = onUserCreate;

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

exports.resolvePendingReview = onCall((request) => resolvePendingReviewLogic(request.auth, request.data));

exports.requestRedemption = onCall((request) => requestRedemptionLogic(request.auth, request.data));

exports.resolveRedemption = onCall((request) => resolveRedemptionLogic(request.auth, request.data));

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
