const { HttpsError } = require('firebase-functions/v2/https');
const { db } = require('./admin');
const { requireRole } = require('./roles');

// Tentative point ladder (Victoria's numbers): coffee mug = 500, Disney/
// Universal trip (~$1,000 value) = 10,000. Everything else is scaled
// between those two anchors - easy to retune later from the Firestore
// console or a future admin screen, this is just a reasonable starting
// point so the marketplace isn't empty on day one.
const INITIAL_REWARDS = [
  { name: 'Coffee Mug', pointCost: 500 },
  { name: 'Tumbler', pointCost: 700 },
  { name: 'Amazon Fire Stick', pointCost: 1200 },
  { name: 'Wireless Headphones', pointCost: 1500 },
  { name: '$25 Gift Card', pointCost: 1800 },
  { name: 'Backpack', pointCost: 2000 },
  { name: '$50 Gift Card', pointCost: 3000 },
  { name: 'Roomba', pointCost: 5000 },
  { name: 'Smart TV', pointCost: 6500 },
  { name: 'Disney World Trip for Two', pointCost: 10000 },
  { name: 'Universal Studios Trip for Two', pointCost: 10000 },
  { name: 'Custom Reward (up to $1,000)', pointCost: 10000 },
];

// Admin-only, and a no-op if rewards already exist - safe to call more than
// once (e.g. by accident) without duplicating the catalog.
async function seedInitialRewardsLogic(auth, data) {
  requireRole(auth, ['admin']);

  const existing = await db.collection('rewards').limit(1).get();
  if (!existing.empty) {
    throw new HttpsError('failed-precondition', 'Rewards already exist - seed only runs on an empty catalog.');
  }

  const batch = db.batch();
  INITIAL_REWARDS.forEach((reward) => {
    const ref = db.collection('rewards').doc();
    batch.set(ref, { ...reward, description: '', imageUrl: null, active: true });
  });
  await batch.commit();

  return { success: true, count: INITIAL_REWARDS.length };
}

module.exports = { seedInitialRewardsLogic, INITIAL_REWARDS };
