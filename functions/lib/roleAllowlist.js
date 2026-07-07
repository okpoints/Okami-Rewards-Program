// Bootstrap accounts - people whose role is assigned automatically on
// signup because there's no admin panel yet to promote them manually.
// Once the app can promote accounts itself, new entries shouldn't need to
// be added here except in unusual cases.
const ADMIN_ALLOWLIST = {
  'vloopup@gmail.com': 'Victoria P',
  'vale@okoh.io': 'Valeria P',
};

// Filled in once the manager roster is provided.
const MANAGER_ALLOWLIST = {};

function getBootstrapRole(email) {
  if (!email) return null;
  const key = email.toLowerCase().trim();
  if (ADMIN_ALLOWLIST[key]) return { role: 'admin', fullName: ADMIN_ALLOWLIST[key] };
  if (MANAGER_ALLOWLIST[key]) return { role: 'manager', fullName: MANAGER_ALLOWLIST[key] };
  return null;
}

module.exports = { getBootstrapRole };
