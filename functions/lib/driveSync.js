const { google } = require('googleapis');
const { parse } = require('csv-parse/sync');
const { db, admin } = require('./admin');
const { normalizeName } = require('./nameMatching');
const { logActivity } = require('./activityLog');

// The "Okami Rewards Program" Drive folder that holds the weekly
// DSP_Overview_Dashboard_OKMI_DCL9_<week>.csv exports from Cortex.
const DRIVE_FOLDER_ID = '1Fpje-R2b1MoiYnf4_fmBf-PgpLXReD3C';

async function getDriveClient() {
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  return google.drive({ version: 'v3', auth });
}

async function findLatestCsv(drive) {
  const res = await drive.files.list({
    q: `'${DRIVE_FOLDER_ID}' in parents and mimeType = 'text/csv' and trashed = false`,
    orderBy: 'createdTime desc',
    pageSize: 1,
    fields: 'files(id, name, createdTime)',
  });
  return res.data.files[0] || null;
}

async function downloadCsv(drive, fileId) {
  const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'text' });
  return res.data;
}

function parseWeekFromFilename(filename) {
  const match = filename.match(/(\d{4}-W\d{2})/);
  return match ? match[1] : null;
}

// Reads the newest Cortex CSV, matches each row to an associate by name,
// and either credits their points or - if the name is ambiguous/unknown -
// flags it in pendingReview instead of guessing.
async function syncCortexFile() {
  const drive = await getDriveClient();
  const file = await findLatestCsv(drive);
  if (!file) {
    throw new Error('No CSV file found in the Okami Rewards Program Drive folder.');
  }

  const week = parseWeekFromFilename(file.name) || file.id;
  const importRef = db.collection('cortexImports').doc(week);
  const alreadyImported = await importRef.get();
  if (alreadyImported.exists) {
    console.log(`Week ${week} already imported, skipping.`);
    return { week, skipped: true };
  }

  const csvText = await downloadCsv(drive, file.id);
  const rows = parse(csvText, { columns: true, skip_empty_lines: true, bom: true, trim: true });

  const associatesSnap = await db.collection('users').where('role', '==', 'associate').get();
  const associates = associatesSnap.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
    nameNormalized: normalizeName(doc.data().fullName),
  }));

  const batch = db.batch();
  let matchedCount = 0;
  let flaggedCount = 0;

  for (const row of rows) {
    const rawName = (row['Delivery Associate'] || '').trim();
    const standing = row['Overall Standing'];
    const score = parseFloat(row['Overall Score']);
    if (!rawName || Number.isNaN(score)) continue;

    const normalized = normalizeName(rawName);
    const matches = associates.filter((a) => a.nameNormalized === normalized);

    if (matches.length === 1) {
      const user = matches[0];
      const ledgerRef = db.collection('users').doc(user.id).collection('pointsLedger').doc(week);
      batch.set(ledgerRef, {
        week,
        points: score,
        standing,
        source: 'cortex-sync',
        rawName,
        createdAt: admin.firestore.Timestamp.now(),
      });
      batch.update(db.collection('users').doc(user.id), {
        totalPoints: admin.firestore.FieldValue.increment(score),
      });
      matchedCount += 1;
    } else {
      // Zero matches (unknown name) or multiple matches (ambiguous) both
      // go to pendingReview rather than being auto-resolved.
      const reviewRef = db.collection('pendingReview').doc();
      batch.set(reviewRef, {
        type: 'unmatchedName',
        week,
        rawName,
        standing,
        score,
        candidateUserIds: matches.map((m) => m.id),
        status: 'open',
        createdAt: admin.firestore.Timestamp.now(),
      });
      flaggedCount += 1;
    }
  }

  batch.set(importRef, {
    week,
    fileId: file.id,
    fileName: file.name,
    importedAt: admin.firestore.Timestamp.now(),
    matchedCount,
    flaggedCount,
  });

  await batch.commit();

  await logActivity({
    actorId: 'system',
    actorName: 'Cortex Sync',
    actorPosition: 'system',
    action: 'cortex_import',
    targetType: 'cortexImports',
    targetId: week,
    details: { matchedCount, flaggedCount, fileName: file.name },
  });

  if (flaggedCount > 0) {
    await notifyManagersOfPendingReview(flaggedCount, week);
  }

  return { week, matchedCount, flaggedCount };
}

async function notifyManagersOfPendingReview(count, week) {
  const managersSnap = await db.collection('users').where('role', 'in', ['manager', 'admin']).get();
  const batch = db.batch();
  managersSnap.docs.forEach((doc) => {
    const notifRef = db.collection('users').doc(doc.id).collection('notifications').doc();
    batch.set(notifRef, {
      type: 'pendingReview',
      message: `${count} name(s) from the Week ${week} Cortex import need review.`,
      read: false,
      createdAt: admin.firestore.Timestamp.now(),
    });
  });
  await batch.commit();
}

module.exports = { syncCortexFile };
