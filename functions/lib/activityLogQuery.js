const { HttpsError } = require('firebase-functions/v2/https');
const { db, admin } = require('./admin');

// The one sanctioned way to browse the activity log. Direct Firestore
// reads of the collection are admin-only (see firestore.rules) because
// "a manager sees driver activity but never admin activity, only if
// granted" isn't something declarative security rules can safely express -
// it needs real server-side filtering.
async function queryActivityLogLogic(auth, data) {
  if (!auth) throw new HttpsError('unauthenticated', 'You must be signed in.');
  const role = auth.token.role;
  const { actorName, actorId, actorPosition, action, dateFrom, dateTo, limit, startAfterId } = data || {};

  if (role === 'associate' || !role) {
    throw new HttpsError('permission-denied', 'Drivers do not have access to the activity log.');
  }

  if (role === 'manager') {
    const managerSnap = await db.collection('users').doc(auth.uid).get();
    if (!managerSnap.data()?.permissions?.viewActivityLog) {
      throw new HttpsError('permission-denied', 'You have not been granted activity log access.');
    }
  }

  let query = db.collection('activityLog').orderBy('createdAt', 'desc');
  if (dateFrom) query = query.where('createdAt', '>=', admin.firestore.Timestamp.fromDate(new Date(dateFrom)));
  if (dateTo) query = query.where('createdAt', '<=', admin.firestore.Timestamp.fromDate(new Date(dateTo)));
  if (actorId) query = query.where('actorId', '==', actorId);

  const pageSize = Math.min(limit || 15, 100);
  query = query.limit(pageSize);
  if (startAfterId) {
    const cursorDoc = await db.collection('activityLog').doc(startAfterId).get();
    if (cursorDoc.exists) query = query.startAfter(cursorDoc);
  }

  const snap = await query.get();
  let entries = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const hasMore = snap.docs.length === pageSize;
  const lastId = snap.docs.length ? snap.docs[snap.docs.length - 1].id : null;

  // Managers only ever see driver/associate-authored entries, regardless
  // of what they ask for - admin and other-manager activity is never
  // exposed through this path even with viewActivityLog granted. Applied
  // after paging, so a manager's page can legitimately come back smaller
  // than pageSize even when hasMore is true.
  if (role === 'manager') {
    entries = entries.filter((e) => e.actorPosition === 'associate');
  } else if (actorPosition) {
    entries = entries.filter((e) => e.actorPosition === actorPosition);
  }

  if (actorName) {
    const needle = actorName.toLowerCase();
    entries = entries.filter((e) => (e.actorName || '').toLowerCase().includes(needle));
  }
  if (action) {
    entries = entries.filter((e) => e.action === action);
  }

  return { entries, lastId, hasMore };
}

module.exports = { queryActivityLogLogic };
