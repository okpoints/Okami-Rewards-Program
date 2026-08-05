const { HttpsError } = require('firebase-functions/v2/https');
const { db, admin } = require('./admin');
const { findCandidates } = require('./nameMatching');
const { logActivity } = require('./activityLog');
const { notifyManagers } = require('./notify');

// A driver signing up types their name; we suggest who they probably are
// on the Cortex roster so the app can ask "are you ___?"
async function findRosterCandidatesLogic(auth, data) {
  if (!auth) throw new HttpsError('unauthenticated', 'You must be signed in.');
  const { enteredName } = data || {};
  if (!enteredName) throw new HttpsError('invalid-argument', 'enteredName is required.');

  const unclaimedSnap = await db.collection('roster').where('linkedUserId', '==', null).get();
  const rosterEntries = unclaimedSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const candidates = findCandidates(enteredName, rosterEntries);

  return { candidates: candidates.map((c) => ({ rosterId: c.id, fullName: c.cortexFullName })) };
}

// The driver's "yes that's me" (or "none of these") only ever creates a
// review for a manager/admin - we never link an account to someone else's
// point history on self-attestation alone, since that would let anyone
// claim someone else's points just by typing their name.
async function requestIdentityLinkLogic(auth, data) {
  if (!auth) throw new HttpsError('unauthenticated', 'You must be signed in.');
  const { rosterId, enteredName } = data || {};
  if (!enteredName) throw new HttpsError('invalid-argument', 'enteredName is required.');

  const reviewRef = db.collection('pendingReview').doc();
  await reviewRef.set({
    type: 'signupIdentityConfirmation',
    userId: auth.uid,
    enteredName,
    suggestedRosterId: rosterId || null,
    status: 'open',
    createdAt: admin.firestore.Timestamp.now(),
  });

  await notifyManagers(
    'pendingReview',
    rosterId
      ? `New signup "${enteredName}" says they're Cortex roster ID ${rosterId} - needs confirmation.`
      : `New signup "${enteredName}" couldn't be matched to anyone on the Cortex roster - needs review.`
  );

  await logActivity({
    actorId: auth.uid,
    actorName: enteredName,
    actorPosition: 'associate',
    action: 'request_identity_link',
    targetType: 'pendingReview',
    targetId: reviewRef.id,
    details: { rosterId },
  });

  return { success: true, reviewId: reviewRef.id };
}

// Manager/admin gives the final approval, linking the driver's account to a
// roster entry and crediting every week of points already sitting on it.
async function resolveIdentityLinkLogic(auth, data, requireRole) {
  const role = requireRole(auth, ['manager', 'admin']);
  const { reviewId, rosterId } = data || {};
  if (!reviewId || !rosterId) {
    throw new HttpsError('invalid-argument', 'reviewId and rosterId are required.');
  }

  const reviewRef = db.collection('pendingReview').doc(reviewId);
  const rosterRef = db.collection('roster').doc(rosterId);

  const ledgerSnap = await rosterRef.collection('ledger').get();
  const totalHistoricalPoints = ledgerSnap.docs.reduce((sum, d) => sum + (d.data().points || 0), 0);
  // Week IDs look like "2026-W25" - lexicographic comparison sorts them correctly.
  const latestLedgerEntry = ledgerSnap.docs
    .map((d) => d.data())
    .sort((a, b) => (b.week || '').localeCompare(a.week || ''))[0];

  await db.runTransaction(async (tx) => {
    const [reviewSnap, rosterSnap] = await Promise.all([tx.get(reviewRef), tx.get(rosterRef)]);
    if (!reviewSnap.exists) throw new HttpsError('not-found', 'Review not found.');
    const review = reviewSnap.data();
    if (review.status !== 'open') {
      throw new HttpsError('failed-precondition', 'This has already been resolved by someone else.');
    }
    if (!rosterSnap.exists) throw new HttpsError('not-found', 'Roster entry not found.');
    if (rosterSnap.data().linkedUserId) {
      throw new HttpsError('failed-precondition', 'That roster entry is already linked to another account.');
    }

    tx.update(rosterRef, { linkedUserId: review.userId, linkedAt: admin.firestore.Timestamp.now() });
    tx.update(db.collection('users').doc(review.userId), {
      rosterId,
      totalPoints: admin.firestore.FieldValue.increment(totalHistoricalPoints),
      ...(latestLedgerEntry ? { currentStanding: latestLedgerEntry.standing } : {}),
    });
    tx.update(reviewRef, {
      status: 'resolved',
      resolvedBy: auth.uid,
      resolvedRosterId: rosterId,
      resolvedAt: admin.firestore.Timestamp.now(),
    });
  });

  await logActivity({
    actorId: auth.uid,
    actorName: auth.token.name || 'Unknown',
    actorPosition: role,
    action: 'resolve_identity_link',
    targetType: 'pendingReview',
    targetId: reviewId,
    details: { rosterId, creditedPoints: totalHistoricalPoints },
  });

  return { success: true, creditedPoints: totalHistoricalPoints };
}

// Manager/admin adds an alias/nickname to a roster entry (e.g. "Alex" for
// "Alejandro Martinez") so future signup matching catches it - this is how
// nicknames get handled, since we don't guess them automatically.
async function addRosterAliasLogic(auth, data, requireRole) {
  const role = requireRole(auth, ['manager', 'admin']);
  const { rosterId, alias } = data || {};
  if (!rosterId || !alias) {
    throw new HttpsError('invalid-argument', 'rosterId and alias are required.');
  }

  const rosterRef = db.collection('roster').doc(rosterId);
  const rosterSnap = await rosterRef.get();
  if (!rosterSnap.exists) throw new HttpsError('not-found', 'Roster entry not found.');

  await rosterRef.update({ aliases: admin.firestore.FieldValue.arrayUnion(alias.trim()) });

  await logActivity({
    actorId: auth.uid,
    actorName: auth.token.name || 'Unknown',
    actorPosition: role,
    action: 'add_roster_alias',
    targetType: 'roster',
    targetId: rosterId,
    details: { alias },
  });

  return { success: true };
}

// Manager/admin manually adds someone to the roster before Cortex has ever
// reported them (e.g. a brand-new hire's first week isn't imported yet).
// If Cortex later reports this same person under a slightly different
// spelling, syncCortexFile (see driveSync.js) flags a rosterMergeSuggestions
// entry by name match instead of silently creating a disconnected second
// roster doc - see resolveRosterMergeLogic below for how a manager confirms
// or dismisses that.
async function createRosterEntryLogic(auth, data, requireRole) {
  const role = requireRole(auth, ['manager', 'admin']);
  const { fullName, aliases } = data || {};
  if (!fullName) throw new HttpsError('invalid-argument', 'fullName is required.');

  const rosterRef = db.collection('roster').doc();
  await rosterRef.set({
    transporterId: null,
    cortexFullName: fullName.trim(),
    aliases: aliases || [],
    source: 'manual',
    linkedUserId: null,
    active: true,
    lastSeenWeek: null,
    createdAt: admin.firestore.Timestamp.now(),
    updatedAt: admin.firestore.Timestamp.now(),
  });

  await logActivity({
    actorId: auth.uid,
    actorName: auth.token.name || 'Unknown',
    actorPosition: role,
    action: 'create_roster_entry',
    targetType: 'roster',
    targetId: rosterRef.id,
    details: { fullName },
  });

  return { success: true, rosterId: rosterRef.id };
}

// Manager/admin flips a roster entry active/inactive - e.g. after acting on
// an inactivityScan notification. Never automatic.
async function setRosterActiveLogic(auth, data, requireRole) {
  const role = requireRole(auth, ['manager', 'admin']);
  const { rosterId, active } = data || {};
  if (!rosterId || typeof active !== 'boolean') {
    throw new HttpsError('invalid-argument', 'rosterId and a boolean active are required.');
  }

  const rosterRef = db.collection('roster').doc(rosterId);
  const rosterSnap = await rosterRef.get();
  if (!rosterSnap.exists) throw new HttpsError('not-found', 'Roster entry not found.');

  await rosterRef.update({
    active,
    inactivityFlaggedAt: active ? admin.firestore.FieldValue.delete() : rosterSnap.data().inactivityFlaggedAt || null,
  });

  await logActivity({
    actorId: auth.uid,
    actorName: auth.token.name || 'Unknown',
    actorPosition: role,
    action: active ? 'reactivate_roster_entry' : 'deactivate_roster_entry',
    targetType: 'roster',
    targetId: rosterId,
  });

  return { success: true };
}

// Shared by both merge entry points below: moves fromRosterId's linked
// account onto intoRosterId, crediting every week of points sitting on
// intoRosterId's ledger, then deactivates fromRosterId. intoRosterId must
// not already be linked to someone else - that's re-checked inside the
// transaction against a race, even though the ledger read (and the
// from-entry's linkedUserId) are read just before it starts.
async function performRosterMerge(fromRosterId, intoRosterId, auth) {
  const fromRef = db.collection('roster').doc(fromRosterId);
  const intoRef = db.collection('roster').doc(intoRosterId);

  const fromSnap = await fromRef.get();
  if (!fromSnap.exists || !fromSnap.data().linkedUserId) {
    throw new HttpsError('failed-precondition', 'The entry being merged from must be linked to an account.');
  }
  const linkedUserId = fromSnap.data().linkedUserId;

  const ledgerSnap = await intoRef.collection('ledger').get();
  const totalHistoricalPoints = ledgerSnap.docs.reduce((sum, d) => sum + (d.data().points || 0), 0);
  const latestLedgerEntry = ledgerSnap.docs
    .map((d) => d.data())
    .sort((a, b) => (b.week || '').localeCompare(a.week || ''))[0];

  await db.runTransaction(async (tx) => {
    const intoSnap = await tx.get(intoRef);
    if (!intoSnap.exists) throw new HttpsError('not-found', 'Target roster entry not found.');
    if (intoSnap.data().linkedUserId) {
      throw new HttpsError('failed-precondition', 'That roster entry is already linked to an account.');
    }

    tx.update(intoRef, { linkedUserId, linkedAt: admin.firestore.Timestamp.now() });
    // Clearing linkedUserId here (not just deactivating) matters now that
    // matching is name-based: if this same driver's name drifts back to
    // matching fromRef's spelling in a future week, fromRef must no longer
    // look "linked" - otherwise the linked-roster credit loop below would
    // credit that week's points to this account twice, once via fromRef and
    // once via intoRef.
    tx.update(fromRef, {
      active: false,
      linkedUserId: null,
      mergedInto: intoRosterId,
      mergedAt: admin.firestore.Timestamp.now(),
    });
    tx.update(db.collection('users').doc(linkedUserId), {
      rosterId: intoRosterId,
      totalPoints: admin.firestore.FieldValue.increment(totalHistoricalPoints),
      ...(latestLedgerEntry ? { currentStanding: latestLedgerEntry.standing } : {}),
    });
  });

  return totalHistoricalPoints;
}

// Manager/admin confirms or dismisses a merge suggestion raised during
// Cortex sync (see driveSync.js) - "merge" retires the manually-created
// entry and moves its linked account onto the real Cortex-keyed one,
// crediting every week of points that were sitting there unclaimed;
// "dismiss" just means it's a coincidence, both entries stay as they are.
async function resolveRosterMergeLogic(auth, data, requireRole) {
  const role = requireRole(auth, ['manager', 'admin']);
  const { suggestionId, decision } = data || {};
  if (!suggestionId || !['merge', 'dismiss'].includes(decision)) {
    throw new HttpsError('invalid-argument', 'suggestionId and a decision of "merge" or "dismiss" are required.');
  }

  const suggestionRef = db.collection('rosterMergeSuggestions').doc(suggestionId);
  const suggestionSnap = await suggestionRef.get();
  if (!suggestionSnap.exists) throw new HttpsError('not-found', 'Merge suggestion not found.');
  const suggestion = suggestionSnap.data();
  if (suggestion.status !== 'pending') throw new HttpsError('failed-precondition', 'This suggestion was already resolved.');

  if (decision === 'dismiss') {
    await suggestionRef.update({ status: 'dismissed', resolvedBy: auth.uid, resolvedAt: admin.firestore.Timestamp.now() });
    await logActivity({
      actorId: auth.uid, actorName: auth.token.name || 'Unknown', actorPosition: role,
      action: 'dismiss_roster_merge', targetType: 'rosterMergeSuggestions', targetId: suggestionId,
    });
    return { success: true };
  }

  const totalHistoricalPoints = await performRosterMerge(suggestion.fromRosterId, suggestion.intoRosterId, auth);
  await suggestionRef.update({ status: 'merged', resolvedBy: auth.uid, resolvedAt: admin.firestore.Timestamp.now() });

  await logActivity({
    actorId: auth.uid, actorName: auth.token.name || 'Unknown', actorPosition: role,
    action: 'merge_roster_entries', targetType: 'rosterMergeSuggestions', targetId: suggestionId,
    details: { fromRosterId: suggestion.fromRosterId, intoRosterId: suggestion.intoRosterId, creditedPoints: totalHistoricalPoints },
  });

  return { success: true, creditedPoints: totalHistoricalPoints };
}

// Manager/admin-initiated merge from the Roster card itself - for fixing a
// mis-click on a suggestion, or a name variation the automatic Cortex-sync
// matching missed entirely. Same underlying operation as confirming a
// suggestion, just without one having been raised first.
async function mergeRosterEntriesLogic(auth, data, requireRole) {
  const role = requireRole(auth, ['manager', 'admin']);
  const { fromRosterId, intoRosterId } = data || {};
  if (!fromRosterId || !intoRosterId || fromRosterId === intoRosterId) {
    throw new HttpsError('invalid-argument', 'fromRosterId and a different intoRosterId are required.');
  }

  const totalHistoricalPoints = await performRosterMerge(fromRosterId, intoRosterId, auth);

  await logActivity({
    actorId: auth.uid, actorName: auth.token.name || 'Unknown', actorPosition: role,
    action: 'merge_roster_entries', targetType: 'roster', targetId: intoRosterId,
    details: { fromRosterId, intoRosterId, creditedPoints: totalHistoricalPoints },
  });

  return { success: true, creditedPoints: totalHistoricalPoints };
}

module.exports = {
  findRosterCandidatesLogic,
  requestIdentityLinkLogic,
  resolveIdentityLinkLogic,
  addRosterAliasLogic,
  createRosterEntryLogic,
  setRosterActiveLogic,
  resolveRosterMergeLogic,
  mergeRosterEntriesLogic,
};
