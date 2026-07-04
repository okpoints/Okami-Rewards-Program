const { HttpsError } = require('firebase-functions/v2/https');

// Roles are stored as a custom claim on the Firebase Auth user (request.auth.token.role),
// set when an account is provisioned. See README for how that gets assigned.
function requireRole(auth, allowedRoles) {
  if (!auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in.');
  }
  const role = auth.token.role;
  if (!allowedRoles.includes(role)) {
    throw new HttpsError('permission-denied', `Requires one of roles: ${allowedRoles.join(', ')}`);
  }
  return role;
}

module.exports = { requireRole };
