/**
 * PARITY with the browser. The application fields a document token may name
 * are listed twice: `APPLICATION_TOKEN_FIELDS` in `postApplicationEdocs.js`,
 * which fills a post-application document, and
 * `src/config/applicationTokenFields.json`, which fills a document sent from a
 * template to an applicant or lead (`src/features/signing/utils/recordPrefill.js`).
 * `functions/` is CommonJS and deployed on its own, so they cannot be one
 * module. If they drifted, one of the two could put a field on a sealed
 * document that the other keeps off it, the SSN included.
 *
 * The server's list is read from what its prefill builder does, not from its
 * source text: an application that answers every field with its own name shows
 * which token each field fills. A token added to the builder outside the list
 * is caught the same way. The browser copy lives in `src/config/`, which runs
 * this lane on any change to it.
 */
jest.mock('firebase-functions/v2/https', () => ({
  onCall: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
  HttpsError: class HttpsError extends Error {},
}));
jest.mock('../../firebaseAdmin', () => ({ admin: { firestore: { FieldValue: {}, Timestamp: {} } }, db: {} }));
jest.mock('../../shared/rateLimiter', () => ({ checkRateLimit: jest.fn() }));
jest.mock('../../shared/companyTenant', () => ({ assertCompanyAcceptingIntake: jest.fn() }));

const { readFileSync } = require('fs');
const { resolve } = require('path');
const { __private } = require('../../postApplicationEdocs');

const BROWSER_COPY = resolve(__dirname, '../../../src/config/applicationTokenFields.json');

/** An application whose every field holds `<its own name>`. */
const everyFieldNamed = new Proxy({}, {
  get: (_target, key) => (typeof key === 'string' ? `<${key}>` : undefined),
});

/** token → application field, as the server's builder fills them. */
function serverTokenFields() {
  const context = __private.buildPrefillContextFromApplication(everyFieldNamed, 'Artificial Freight Co');
  const fields = {};
  for (const [token, value] of Object.entries(context)) {
    const named = /^<([^<>]+)>$/.exec(String(value));
    if (named) fields[token] = named[1];
  }
  return fields;
}

describe('application token fields: server and browser', () => {
  it('fill the same tokens from the same application fields', () => {
    const browser = JSON.parse(readFileSync(BROWSER_COPY, 'utf8'));
    const server = serverTokenFields();
    // The signer's number is the recipient's in the browser, which the wizard
    // takes from its own field; the server reads it from `phone` or `phoneNumber`.
    expect(server.phone).toBe('phone');
    delete server.phone;

    expect(browser).toEqual(server);
  });

  it('never name the SSN, a signature, a consent or an id', () => {
    const server = serverTokenFields();
    const named = Object.values(server).join(' ');
    expect(named).not.toMatch(/ssn|signature|consent|confirmation|Id\b|applicantId|driverId|userId/i);
  });
});
