// Bootstrap admins - these are the only two accounts that become Admin
// automatically on signup. Once the app has an admin panel for promoting
// other accounts to Manager/Admin, new entries shouldn't need to be added here.
const ADMIN_ALLOWLIST = {
  'vloopup@gmail.com': 'Victoria P',
  'vale@okoh.io': 'Valeria P',
};

function getBootstrapAdmin(email) {
  if (!email) return null;
  const key = email.toLowerCase().trim();
  const fullName = ADMIN_ALLOWLIST[key];
  return fullName ? { email: key, fullName } : null;
}

module.exports = { getBootstrapAdmin };
