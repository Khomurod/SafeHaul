/**
 * Stand-in for `jose` under Jest (wired in package.json `jest.moduleNameMapper`).
 *
 * jose 6, which firebase-admin 14 pulls in through jwks-rsa, ships only as an ES
 * module. The deployed functions load it through Node 22's own require(esm), but
 * Jest on Node 22 cannot, so every suite that loads `firebase-admin/auth` — any
 * suite using the real `firebase-functions` https module — would fail to start.
 *
 * Only App Check and phone-number token checks call into jose; the app makes
 * neither and no unit test does, and a test that ever did would fail on this
 * empty object instead of passing on a fake. `firebaseAdmin.test.js` loads the
 * real entry point under plain Node, where the real jose runs.
 */
module.exports = {};
