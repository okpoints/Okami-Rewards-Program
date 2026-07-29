const { google } = require('googleapis');
const { parse } = require('csv-parse/sync');
const { db, admin } = require('./admin');
const { logActivity } = require('./activityLog');

// The "Okami Rewards Program" Drive folder that holds the weekly
// DSP_Overview_Dashboard_OKMI_DCL9_<week>.csv exports from Cortex.
const DRIVE_FOLDER_ID = '1Fpje-R2b1MoiYnf4_fmBf-PgpLXReD3C';

// Individual Cortex metric scores used to tell a driver what they're doing
// well and what needs work. A weight-applied of 0 means that metric had no
// coverage for them that week (e.g. no rental vehicle), so it's excluded.
const METRICS = [
  { label: 'Speeding', scoreKey: 'Speeding Event Rate Score', weightKey: 'Speeding Event Rate Weight Applied' },
  { label: 'Seatbelt Use', scoreKey: 'Seatbelt-Off Rate Score', weightKey: 'Seatbelt-Off Rate Weight Applied' },
  { label: 'Distracted Driving', scoreKey: 'Distractions Rate Score', weightKey: 'Distractions Rate Weight Applied' },
  { label: 'Sign/Signal Compliance', scoreKey: 'Sign/ Signal Violations Rate Score', weightKey: 'Sign/ Signal Violations Rate Weight Applied' },
  { label: 'Following Distance', scoreKey: 'Following Distance Rate Score', weightKey: 'Following Distance Rate Weight Applied' },
  { label: 'Customer Delivery Feedback', scoreKey: 'CDF DPMO Score', weightKey: 'CDF DPMO Weight Applied' },
  { label: 'Customer Escalation (CED)', scoreKey: 'CED Score', weightKey: 'CED Weight Applied' },
  { label: 'Delivery Success (DSB)', scoreKey: 'DSB DPMO Score', weightKey: 'DSB DPMO Weight Applied' },
  { label: 'Photo on Delivery (POD)', scoreKey: 'POD Score', weightKey: 'POD Weight Applied' },
  { label: 'Package Sort/Scan (PSB)', scoreKey: 'PSB Score', weightKey: 'PSB Weight Applied' },
];

function bestAndWorstMetric(row) {
  const scored = METRICS.map((m) => ({
    label: m.label,
    score: parseFloat(row[m.scoreKey]),
    weight: parseFloat(row[m.weightKey]),
  })).filter((m) => !Number.isNaN(m.score) && m.weight > 0);

  if (scored.length === 0) return { best: null, worst: null };

  const best = scored.reduce((a, b) => (b.score > a.score ? b : a));
  const worst = scored.reduce((a, b) => (b.score < a.score ? b : a));
  return { best: best.label, worst: worst.label };
}

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

// Reads the newest Cortex CSV and upserts a roster entry per Transporter ID
// (a stable ID Cortex assigns per person, unlike their name which is
// formatted inconsistently week to week). Each row also writes a ledger
// entry under that roster doc. If the roster entry is already linked to a
// real driver account, their totalPoints is credited immediately; otherwise
// the points just sit on the roster until someone claims it at signup time
// (see roster.js) - turnover here is expected to be constant, so there's
// no separate "known roster" to maintain by hand.
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

  const batch = db.batch();
  let rosterUpdates = 0;

  for (const row of rows) {
    const transporterId = (row['Transporter ID'] || '').trim();
    const rawName = (row['Delivery Associate'] || '').trim();
    const standing = row['Overall Standing'];
    const score = parseFloat(row['Overall Score']);
    if (!transporterId || !rawName || Number.isNaN(score)) continue;

    const { best, worst } = bestAndWorstMetric(row);
    const rosterRef = db.collection('roster').doc(transporterId);
    const ledgerRef = rosterRef.collection('ledger').doc(week);

    batch.set(ledgerRef, {
      week,
      points: score,
      standing,
      bestMetric: best,
      worstMetric: worst,
      rawName,
      source: 'cortex-sync',
      createdAt: admin.firestore.Timestamp.now(),
    });
    batch.set(
      rosterRef,
      {
        transporterId,
        cortexFullName: rawName,
        active: true,
        lastSeenWeek: week,
        updatedAt: admin.firestore.Timestamp.now(),
      },
      { merge: true }
    );

    rosterUpdates += 1;
  }

  batch.set(importRef, {
    week,
    fileId: file.id,
    fileName: file.name,
    importedAt: admin.firestore.Timestamp.now(),
    rosterUpdates,
  });
  await batch.commit();

  // Credit points immediately for any roster entries already linked to a
  // real account from a previous signup confirmation.
  const linkedRosterSnap = await db.collection('roster').where('linkedUserId', '!=', null).get();
  const linkBatch = db.batch();
  let linkedUpdates = 0;
  for (const doc of linkedRosterSnap.docs) {
    const roster = doc.data();
    const ledgerSnap = await doc.ref.collection('ledger').doc(week).get();
    if (!ledgerSnap.exists) continue;
    linkBatch.update(db.collection('users').doc(roster.linkedUserId), {
      totalPoints: admin.firestore.FieldValue.increment(ledgerSnap.data().points),
      currentStanding: ledgerSnap.data().standing,
    });
    linkedUpdates += 1;
  }
  await linkBatch.commit();

  await logActivity({
    actorId: 'system',
    actorName: 'Cortex Sync',
    actorPosition: 'system',
    action: 'cortex_import',
    targetType: 'cortexImports',
    targetId: week,
    details: { fileName: file.name, rosterUpdates, linkedUpdates },
  });

  return { week, rosterUpdates, linkedUpdates };
}

module.exports = { syncCortexFile };
