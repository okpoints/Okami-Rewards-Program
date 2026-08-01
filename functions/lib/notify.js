const { db, admin } = require('./admin');

// Associates get one blanket on/off switch (notificationPreferences.pushEnabled).
// Managers/admins get a toggle per notification type instead, since "every
// little thing" buzzing their phone was explicitly not what was wanted -
// only the categories they actually opt into. A type with no explicit
// entry defaults to on, so new categories aren't silently muted for
// existing accounts.
function isPushEnabledForType(userData, type) {
  const prefs = userData?.notificationPreferences;
  if (!prefs) return true;
  if (userData.role === 'associate') {
    return prefs.pushEnabled !== false;
  }
  if (Object.prototype.hasOwnProperty.call(prefs, type)) {
    return prefs[type] !== false;
  }
  return true;
}

async function sendPushToUser(userId, userData, type, message) {
  const tokens = userData?.fcmTokens;
  if (!tokens || tokens.length === 0) return;
  if (!isPushEnabledForType(userData, type)) return;

  try {
    const response = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: { title: 'Okami Rewards', body: message },
      webpush: { fcmOptions: { link: '/' } },
    });

    // A token can go stale (uninstalled, permission revoked, browser data
    // cleared) - drop those so we stop retrying them forever.
    const staleTokens = [];
    response.responses.forEach((result, i) => {
      const code = result.error?.code;
      if (!result.success && (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-argument')) {
        staleTokens.push(tokens[i]);
      }
    });
    if (staleTokens.length > 0) {
      await db.collection('users').doc(userId).update({
        fcmTokens: admin.firestore.FieldValue.arrayRemove(...staleTokens),
      });
    }
  } catch (err) {
    // Push is a best-effort add-on - the in-app notification (already
    // written by the caller) is the source of truth regardless.
    console.error(`Push send failed for user ${userId}:`, err.message);
  }
}

// Writes the in-app notification and sends push if the recipient has
// opted in and has a registered device. Use this (or notifyManagers/
// notifyRole below) everywhere a notification is created, instead of
// writing to the notifications subcollection directly, so preference
// checking and push delivery stay in one place.
async function notifyUser(userId, type, message) {
  await db.collection('users').doc(userId).collection('notifications').add({
    type, message, read: false, createdAt: admin.firestore.Timestamp.now(),
  });

  const userSnap = await db.collection('users').doc(userId).get();
  if (userSnap.exists) {
    await sendPushToUser(userId, userSnap.data(), type, message);
  }
}

async function notifyUsers(userDocs, type, message) {
  const batch = db.batch();
  userDocs.forEach((doc) => {
    const notifRef = db.collection('users').doc(doc.id).collection('notifications').doc();
    batch.set(notifRef, { type, message, read: false, createdAt: admin.firestore.Timestamp.now() });
  });
  await batch.commit();

  await Promise.all(userDocs.map((doc) => sendPushToUser(doc.id, doc.data(), type, message)));
}

async function notifyManagers(type, message) {
  const managersSnap = await db.collection('users').where('role', 'in', ['manager', 'admin']).get();
  await notifyUsers(managersSnap.docs, type, message);
}

async function notifyAllAssociates(type, message) {
  const associatesSnap = await db.collection('users').where('role', '==', 'associate').get();
  await notifyUsers(associatesSnap.docs, type, message);
}

module.exports = { notifyUser, notifyManagers, notifyAllAssociates, isPushEnabledForType };
