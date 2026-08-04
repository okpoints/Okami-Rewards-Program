const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall } = require('firebase-functions/v2/https');
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
  resolveRosterMergeLogic,
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
const { adjustPointsLogic, deletePointAdjustmentLogic } = require('./lib/pointAdjustments');
const { setManagerPermissionLogic } = require('./lib/permissions');
const { queryActivityLogLogic } = require('./lib/activityLogQuery');
const {
  createAnnouncementLogic,
  updateAnnouncementLogic,
  deleteAnnouncementLogic,
  enrollInAnnouncementLogic,
  confirmAnnouncementParticipantLogic,
  resolveAnnouncementCompletionLogic,
  listAnnouncementEnrollmentsLogic,
  listAnnouncementHistoryLogic,
  seedInitialAnnouncementLogic,
} = require('./lib/announcements');
const { requireRole } = require('./lib/roles');
const { runCortexSyncWithStatusTracking } = require('./lib/syncStatus');
const { setUserRoleLogic } = require('./lib/userRoles');
const { createUserAccountLogic } = require('./lib/userCreation');
const { createInviteLinkLogic, redeemInviteLinkLogic, revokeInviteLinkLogic } = require('./lib/inviteLinks');
const { FIREBASE_ADMIN_SERVICE_ACCOUNT: DRIVE_SERVICE_ACCOUNT } = require('./lib/serviceAccount');

exports.onUserCreate = onUserCreate;

exports.weeklyCortexSync = onSchedule(
  {
    schedule: 'every monday 06:00',
    timeZone: 'America/New_York',
    serviceAccount: DRIVE_SERVICE_ACCOUNT,
  },
  async () => {
    const result = await runCortexSyncWithStatusTracking(syncCortexFile, { notifyOnFailure: true });
    console.log('Cortex sync result:', result);
  }
);

// The "Sync Now" button - same logic as the scheduled job, manager/admin
// triggered. Needs the same Drive-access service account as the scheduled
// version, or it would run as the default compute identity and fail.
exports.manualCortexSync = onCall({ serviceAccount: DRIVE_SERVICE_ACCOUNT }, async (request) => {
  requireRole(request.auth, ['manager', 'admin']);
  return runCortexSyncWithStatusTracking(syncCortexFile, { notifyOnFailure: false });
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
exports.resolveRosterMerge = onCall((request) => resolveRosterMergeLogic(request.auth, request.data, requireRole));

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

// Manual point add/deduct (reason required). Covers no-call/no-show and
// similar deductions until the messy Okami sheets can be parsed - and
// stays available as a permanent feature after that too.
exports.adjustPoints = onCall((request) => adjustPointsLogic(request.auth, request.data, requireRole));

exports.deletePointAdjustment = onCall((request) => deletePointAdjustmentLogic(request.auth, request.data, requireRole));

// Admin grants/revokes optional permissions on a manager's account
// (currently: viewActivityLog).
exports.setManagerPermission = onCall((request) => setManagerPermissionLogic(request.auth, request.data, requireRole));

// setCustomUserClaims needs the same Firebase Admin SDK service account as
// onUserCreate - the default runtime identity doesn't have Auth Admin
// permission to change someone's role.
exports.setUserRole = onCall({ serviceAccount: DRIVE_SERVICE_ACCOUNT }, (request) =>
  setUserRoleLogic(request.auth, request.data, requireRole)
);

// createUser + setCustomUserClaims both need the same Auth Admin
// permission as the functions above.
exports.createUserAccount = onCall({ serviceAccount: DRIVE_SERVICE_ACCOUNT }, (request) =>
  createUserAccountLogic(request.auth, request.data, requireRole)
);

exports.createInviteLink = onCall((request) => createInviteLinkLogic(request.auth, request.data, requireRole));

// setCustomUserClaims needs the Auth Admin service account, same as the
// other role-mutating functions above.
exports.redeemInviteLink = onCall({ serviceAccount: DRIVE_SERVICE_ACCOUNT }, (request) =>
  redeemInviteLinkLogic(request.auth, request.data)
);

exports.revokeInviteLink = onCall((request) => revokeInviteLinkLogic(request.auth, request.data, requireRole));

// The sanctioned way to browse the activity log - see firestore.rules for
// why direct client reads are admin-only.
exports.queryActivityLog = onCall((request) => queryActivityLogLogic(request.auth, request.data));

// Area of Highest Need: one urgent, ad-hoc announcement at a time (unlike
// Bonus Tasks' standing library). Drivers only ever see the headcount
// needed, never who else enrolled - a manager/admin sees the real list and
// confirms who's actually doing it before completion can be approved.
exports.createAnnouncement = onCall((request) => createAnnouncementLogic(request.auth, request.data, requireRole));

exports.updateAnnouncement = onCall((request) => updateAnnouncementLogic(request.auth, request.data, requireRole));

exports.deleteAnnouncement = onCall((request) => deleteAnnouncementLogic(request.auth, request.data, requireRole));

exports.enrollInAnnouncement = onCall((request) => enrollInAnnouncementLogic(request.auth, request.data));

exports.confirmAnnouncementParticipant = onCall((request) =>
  confirmAnnouncementParticipantLogic(request.auth, request.data, requireRole)
);

exports.resolveAnnouncementCompletion = onCall((request) =>
  resolveAnnouncementCompletionLogic(request.auth, request.data, requireRole)
);

exports.listAnnouncementEnrollments = onCall((request) =>
  listAnnouncementEnrollmentsLogic(request.auth, request.data, requireRole)
);

exports.listAnnouncementHistory = onCall((request) =>
  listAnnouncementHistoryLogic(request.auth, request.data, requireRole)
);

exports.seedInitialAnnouncement = onCall((request) =>
  seedInitialAnnouncementLogic(request.auth, request.data, requireRole)
);

// Flags roster entries with no Cortex activity in ~3 months for manager
// review - never auto-deactivates anyone.
exports.inactivityScan = onSchedule('1 of month 06:00', async () => {
  const result = await scanForInactiveDrivers();
  console.log('Inactivity scan result:', result);
});
