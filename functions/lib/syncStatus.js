const { db, admin } = require('./admin');

async function notifyManagers(message) {
  const managersSnap = await db.collection('users').where('role', 'in', ['manager', 'admin']).get();
  const batch = db.batch();
  managersSnap.docs.forEach((doc) => {
    const notifRef = db.collection('users').doc(doc.id).collection('notifications').doc();
    batch.set(notifRef, { type: 'syncFailure', message, read: false, createdAt: admin.firestore.Timestamp.now() });
  });
  await batch.commit();
}

// One status doc so the dashboard can show "sync failed" instead of drivers
// just quietly not seeing updated points with no explanation. The weekly
// scheduled sync notifies managers/admins on failure; a manually-triggered
// sync doesn't (the person clicking it already sees the error immediately),
// but both record status so the banner always reflects reality.
async function runCortexSyncWithStatusTracking(syncCortexFile, { notifyOnFailure }) {
  const statusRef = db.collection('syncStatus').doc('cortex');
  try {
    const result = await syncCortexFile();
    await statusRef.set(
      {
        lastAttemptAt: admin.firestore.Timestamp.now(),
        lastSuccessAt: admin.firestore.Timestamp.now(),
        lastError: null,
      },
      { merge: true }
    );
    return result;
  } catch (err) {
    await statusRef.set(
      {
        lastAttemptAt: admin.firestore.Timestamp.now(),
        lastError: err.message || String(err),
      },
      { merge: true }
    );
    if (notifyOnFailure) {
      await notifyManagers(
        `Weekly Cortex sync failed: ${err.message || 'unknown error'}. Use "Sync Now" once it's fixed, or check the Drive folder.`
      );
    }
    throw err;
  }
}

module.exports = { runCortexSyncWithStatusTracking };
