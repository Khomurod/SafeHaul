/**
 * A random v4 UUID (Node's own `crypto.randomUUID`), for tokens and ids that
 * must not be guessable. One module, so a test can pin the value it returns.
 */
const crypto = require('node:crypto');

const randomId = () => crypto.randomUUID();

module.exports = { randomId };
