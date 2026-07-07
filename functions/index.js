const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall } = require('firebase-functions/v2/https');
const { db, admin } = require('./lib/admin');
const { syncCortexFile } = require('./lib/driveSync');
const { onUserCreate } = require('./lib/authTriggers');
const { requestRedemptionLogic, resolveRedemptionLogic } = require('./lib/redemptions');
const {
  findRosterCandidatesLogic,
  requestIdentityLinkLogic,
  resolveIdentityLinkLogic,
  addRosterAliasLogic,
  createRosterEntryLogic,
  setRosterActiveLogic,
} = require('./lib/roster');
const { seedInitialRewardsLogic } = require('./lib/rewardsSeed');
const { scanForInactiveDrivers } = require('./lib/inactivityScan');
const { recordLoginLogic } = require('./lib/session');
const {
  createBonusTaskLogic,
  updateBonusTaskLogic,
  deleteBonusTaskLogic,
  enrollInBonusTaskLogic,
  resolveBonusTaskLogic,
} = require('./lib/bonusTasks');
const { adjustPointsLogic } = require('./lib/pointAdjustments');
const { requireRole } = require('./lib/roles');

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

// The "Sync Now" button - same logic as the scheduled job, manager/admin triggered.
exports.manualCortexSync = onCall(async (request) => {
  requireRole(request.auth, ['manager', 'admin']);
  return syncCortexFile();
});

exports.requestRedemption = onCall((request) => requestRedemptionLogic(request.auth, request.data));

exports.resolveRedemption = onCall((request) => resolveRedemptionLogic(request.auth, request.data));

// Signup identity flow: driver types their name, we suggest Cortex roster
// matches, they self-attest, then a manager/admin gives the final approval.
exports.findRosterCandidates = onCall((request) => findRosterCandidatesLogic(request.auth, request.data));

exports.requestIdentityLink = onCall((request) => requestIdentityLinkLogic(request.auth, request.data));

exports.resolveIdentityLink = onCall((request) => resolveIdentityLinkLogic(request.auth, request.data, requireRole));

// Roster management: managers/admins can pre-add aliases/nicknames, add a
// driver manually before Cortex reports them, and toggle active/inactive.
exports.addRosterAlias = onCall((request) => addRosterAliasLogic(request.auth, request.data, requireRole));

exports.createRosterEntry = onCall((request) => createRosterEntryLogic(request.auth, request.data, requireRole));

exports.setRosterActive = onCall((request) => setRosterActiveLogic(request.auth, request.data, requireRole));

// Called by the client right after sign-in so "last login" shows on the
// manager-facing roster view.
exports.recordLogin = onCall((request) => recordLoginLogic(request.auth));

exports.seedInitialRewards = onCall((request) => seedInitialRewardsLogic(request.auth, request.data));

// Bonus Tasks: a standing library drivers can enroll in anytime (Rescue,
// Pick up a shift, Train a new employee, Sweep vans, or custom ones a
// manager adds). Points are only awarded once a manager approves completion.
exports.createBonusTask = onCall((request) => createBonusTaskLogic(request.auth, request.data, requireRole));

exports.updateBonusTask = onCall((request) => updateBonusTaskLogic(request.auth, request.data, requireRole));

exports.deleteBonusTask = onCall((request) => deleteBonusTaskLogic(request.auth, request.data, requireRole));

exports.enrollInBonusTask = onCall((request) => enrollInBonusTaskLogic(request.auth, request.data));

exports.resolveBonusTask = onCall((request) => resolveBonusTaskLogic(request.auth, request.data, requireRole));

// Manual point add/deduct (reason required) - stand-in for no-call/no-show
// and similar deductions until the messy Okami sheets can be parsed.
exports.adjustPoints = onCall((request) => adjustPointsLogic(request.auth, request.data, requireRole));

// Flags roster entries with no Cortex activity in ~3 months for manager
// review - never auto-deactivates anyone.
exports.inactivityScan = onSchedule('1 of month 06:00', async () => {
  const result = await scanForInactiveDrivers();
  console.log('Inactivity scan result:', result);
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
