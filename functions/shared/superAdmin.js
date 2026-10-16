const { HttpsError } = require("firebase-functions/v2/https");

/**
 * Whether verified token claims, or a user's stored custom claims, make a super
 * admin: `roles.globalRole`, which a `super_admin` membership grants, or
 * `globalRole` at the token root, which the claims writer keeps. The Firestore
 * and Storage rules and the site read both.
 */
function isSuperAdminClaims(claims) {
    return claims?.globalRole === 'super_admin' || claims?.roles?.globalRole === 'super_admin';
}

/**
 * Refuses a callable unless a signed-in super admin made it. `auth` is a v2
 * `request.auth` or a v1 `context.auth`; it is returned for convenience.
 */
function assertSuperAdminAuth(auth, deniedMessage = 'Super Admin access is required.') {
    if (!auth) throw new HttpsError('unauthenticated', 'Login required.');
    if (!isSuperAdminClaims(auth.token)) throw new HttpsError('permission-denied', deniedMessage);
    return auth;
}

module.exports = { isSuperAdminClaims, assertSuperAdminAuth };
