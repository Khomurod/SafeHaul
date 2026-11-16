/**
 * The application fields a document token may name are one list,
 * `functions/shared/applicationTokenFields.json`: the server fills a
 * post-application document from it (`APPLICATION_TOKEN_FIELDS`,
 * `shared/postApplicationRequest.js`), and the site fills a document sent from
 * a template to an applicant or lead from it
 * (`src/features/signing/utils/recordPrefill.js`). If the server's builder
 * filled a field outside the list, one of the two could put a field on a sealed
 * document that the other keeps off it, the SSN included.
 *
 * The server's list is read from what its prefill builder does, not from its
 * source text: an application that answers every field with its own name shows
 * which token each field fills. A token added to the builder outside the list
 * is caught the same way.
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

const SHARED_LIST = resolve(__dirname, '../../shared/applicationTokenFields.json');

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

describe('application token fields: the one list and the server', () => {
  it('the server fills exactly the listed tokens from the listed fields', () => {
    const listed = JSON.parse(readFileSync(SHARED_LIST, 'utf8'));
    const server = serverTokenFields();
    // The signer's number is the recipient's in the browser, which the wizard
    // takes from its own field; the server reads it from `phone` or `phoneNumber`.
    expect(server.phone).toBe('phone');
    delete server.phone;

    expect(listed).toEqual(server);
  });

  it('never name the SSN, a signature, a consent or an id', () => {
    const server = serverTokenFields();
    const named = Object.values(server).join(' ');
    expect(named).not.toMatch(/ssn|signature|consent|confirmation|Id\b|applicantId|driverId|userId/i);
  });
});
