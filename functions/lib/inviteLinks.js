const crypto = require('crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { db, admin } = require('./admin');
const { logActivity } = require('./activityLog');

// Admin is deliberately excluded - granting admin access always goes
// through Privilege Assignment on an account that already exists, never
// straight through a link. A leaked/forwarded invite link only ever grants
// as much as Employee or Manager.
const INVITABLE_ROLES = ['associate', 'manager'];
const INVITE_EXPIRY_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

function generateToken() {
  return crypto.randomBytes(24).toString('base64url');
}

async function requireCreatePermission(auth, callerRole) {
  if (callerRole === 'manager') {
    const callerSnap = await db.collection('users').doc(auth.uid).get();
    if (!callerSnap.data()?.permissions?.createUserAccounts) {
      throw new HttpsError('permission-denied', 'You have not been granted permission to create user accounts or invite links.');
    }
  }
}

// rosterId is optional - when set (from the Roster card, inviting a
// specific un-signed-up Cortex employee), redeeming this link also links
// that roster entry and credits its historical points, same as a
// manager-approved identity confirmation would - no separate self-
// attestation/matching step needed, since sending this specific link to
// this specific person already IS the confirmation.
async function createInviteLinkLogic(auth, data, requireRole) {
  const callerRole = requireRole(auth, ['admin', 'manager']);
  const { role: inviteRole, label, rosterId } = data || {};
  if (!INVITABLE_ROLES.includes(inviteRole)) {
    throw new HttpsError('invalid-argument', `role must be one of: ${INVITABLE_ROLES.join(', ')}`);
  }
  await requireCreatePermission(auth, callerRole);

  if (rosterId) {
    const rosterSnap = await db.collection('roster').doc(rosterId).get();
    if (!rosterSnap.exists) throw new HttpsError('not-found', 'Roster entry not found.');
    if (rosterSnap.data().linkedUserId) {
      throw new HttpsError('failed-precondition', 'That roster entry is already linked to an account.');
    }
  }

  const token = generateToken();
  const now = admin.firestore.Timestamp.now();
  await db.collection('inviteLinks').doc(token).set({
    role: inviteRole,
    label: label || '',
    rosterId: rosterId || null,
    status: 'active',
    createdBy: auth.uid,
    createdByName: auth.token.name || 'Unknown',
    createdAt: now,
    expiresAt: admin.firestore.Timestamp.fromMillis(now.toMillis() + INVITE_EXPIRY_MS),
    usedBy: null,
    usedByName: null,
    usedAt: null,
  });

  await logActivity({
    actorId: auth.uid,
    actorName: auth.token.name || 'Unknown',
    actorPosition: callerRole,
    action: 'create_invite_link',
    targetType: 'inviteLinks',
    targetId: token,
    details: { role: inviteRole, label: label || '', rosterId: rosterId || null },
  });

  return { success: true, token };
}

// onUserCreate (see authTriggers.js) sets custom claims THEN writes the
// Firestore doc, in that order, awaited sequentially - so once the doc
// exists, that trigger has fully finished and won't fire again for this
// account. Waiting for it here means our write below is guaranteed to be
// the last one, instead of racing a trigger we don't control the timing of.
async function waitForUserDoc(uid) {
  const ref = db.collection('users').doc(uid);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const snap = await ref.get();
    if (snap.exists) return ref;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new HttpsError('deadline-exceeded', 'Your account is still being set up - please try redeeming the invite link again in a few seconds.');
}

// Called by the newly-signed-up account itself right after
// createUserWithEmailAndPassword - upgrades them from the default
// associate role to whatever the invite specifies. Anyone holding a
// valid, unused, unexpired link can redeem it for their own account, same
// trust model as a Slack/Discord invite link - which is why links expire
// and are single-use.
async function redeemInviteLinkLogic(auth, data) {
  if (!auth) throw new HttpsError('unauthenticated', 'You must be signed in.');
  const { token } = data || {};
  if (!token) throw new HttpsError('invalid-argument', 'token is required.');

  const userRef = await waitForUserDoc(auth.uid);
  const inviteRef = db.collection('inviteLinks').doc(token);

  // Read the invite once up front (outside the transaction) just to see if
  // it names a roster entry - if so we need its ledger total before the
  // transaction starts, same pattern resolveIdentityLinkLogic uses.
  const preSnap = await inviteRef.get();
  const rosterId = preSnap.exists ? (preSnap.data().rosterId ?? null) : null;
  let rosterRef = null;
  let totalHistoricalPoints = 0;
  let latestLedgerEntry = null;
  if (rosterId) {
    rosterRef = db.collection('roster').doc(rosterId);
    const ledgerSnap = await rosterRef.collection('ledger').get();
    totalHistoricalPoints = ledgerSnap.docs.reduce((sum, d) => sum + (d.data().points || 0), 0);
    latestLedgerEntry = ledgerSnap.docs
      .map((d) => d.data())
      .sort((a, b) => (b.week || '').localeCompare(a.week || ''))[0];
  }

  const inviteRole = await db.runTransaction(async (tx) => {
    const inviteSnap = await tx.get(inviteRef);
    if (!inviteSnap.exists) throw new HttpsError('not-found', 'This invite link is not valid.');
    const invite = inviteSnap.data();
    if (invite.status !== 'active') {
      throw new HttpsError('failed-precondition', 'This invite link has already been used or was revoked.');
    }
    if (invite.expiresAt.toMillis() < Date.now()) {
      throw new HttpsError('failed-precondition', 'This invite link has expired.');
    }

    tx.update(inviteRef, {
      status: 'used',
      usedBy: auth.uid,
      usedByName: auth.token.name || 'Unknown',
      usedAt: admin.firestore.Timestamp.now(),
    });

    const userUpdates = { role: invite.role, permissions: admin.firestore.FieldValue.delete() };

    if (invite.rosterId) {
      userUpdates.rosterId = invite.rosterId;
      userUpdates.totalPoints = admin.firestore.FieldValue.increment(totalHistoricalPoints);
      if (latestLedgerEntry) userUpdates.currentStanding = latestLedgerEntry.standing;
    }
    tx.update(userRef, userUpdates);

    if (invite.rosterId) {
      tx.update(db.collection('roster').doc(invite.rosterId), {
        linkedUserId: auth.uid,
        linkedAt: admin.firestore.Timestamp.now(),
      });
    }

    return invite.role;
  });

  await admin.auth().setCustomUserClaims(auth.uid, { role: inviteRole });

  await logActivity({
    actorId: auth.uid,
    actorName: auth.token.name || 'Unknown',
    actorPosition: inviteRole,
    action: 'redeem_invite_link',
    targetType: 'inviteLinks',
    targetId: token,
    details: { role: inviteRole, rosterId, creditedPoints: totalHistoricalPoints },
  });

  return { success: true, role: inviteRole };
}

async function revokeInviteLinkLogic(auth, data, requireRole) {
  const callerRole = requireRole(auth, ['admin', 'manager']);
  const { token } = data || {};
  if (!token) throw new HttpsError('invalid-argument', 'token is required.');
  await requireCreatePermission(auth, callerRole);

  const inviteRef = db.collection('inviteLinks').doc(token);
  const inviteSnap = await inviteRef.get();
  if (!inviteSnap.exists) throw new HttpsError('not-found', 'Invite link not found.');
  if (inviteSnap.data().status !== 'active') {
    throw new HttpsError('failed-precondition', 'This invite link is already used or revoked.');
  }

  await inviteRef.update({ status: 'revoked' });

  await logActivity({
    actorId: auth.uid,
    actorName: auth.token.name || 'Unknown',
    actorPosition: callerRole,
    action: 'revoke_invite_link',
    targetType: 'inviteLinks',
    targetId: token,
  });

  return { success: true };
}

module.exports = { createInviteLinkLogic, redeemInviteLinkLogic, revokeInviteLinkLogic, INVITABLE_ROLES };
