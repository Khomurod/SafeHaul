/**
 * The fields a draft never stores. One list, two runtimes, no firebase.
 *
 * `ssn` and `signature` are stripped from every draft copy on purpose — PII and a
 * biometric, removed from the local browser copy, from the client payload, and
 * again on arrival at every depth of the object.
 *
 * **This module must stay dependency-free**, and that is not a style preference.
 * The list is a fact about the schema, and three separate things need it: the
 * server's draft sanitizer, the server's submission validator, and the browser's
 * check that a resumed applicant re-supplies whatever a company requires. It used
 * to live in `applicationDraft.js`, which loads `firebaseAdmin` — so a frontend
 * test that read it there failed in CI, where the frontend job installs no
 * `firebase-admin`. Anything added here must import nothing.
 */

const NEVER_STORED = Object.freeze(['ssn', 'signature']);

module.exports = { NEVER_STORED };
