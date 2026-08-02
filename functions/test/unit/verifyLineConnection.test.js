// Guards that verifyLineConnection rejects a malformed/blank phone number (e.g. the
// bare "+") with a clear invalid-argument BEFORE reaching the keychain lookup — so the
// user never sees the confusing "No authentication key found for +" message.

jest.mock('firebase-functions/v2/https', () => ({
  onCall: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
  HttpsError: class HttpsError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  },
}));

// Minimal stubs so requiring configController.js doesn't pull real SDKs.
jest.mock('../../integrations/factory', () => ({ getAdapter: jest.fn() }));
jest.mock('../../integrations/encryption', () => ({ encrypt: jest.fn(), decrypt: jest.fn() }));
jest.mock('../../integrations/adapters/ringcentral', () => class {});
jest.mock('../../integrations/adapters/eightbyeight', () => class {});
jest.mock('@ringcentral/sdk', () => ({ SDK: class {} }));

const mockMembershipGet = jest.fn();
jest.mock('firebase-admin', () => ({
  firestore: Object.assign(
    () => ({
      collection: () => ({
        where: () => ({ where: () => ({ get: (...a) => mockMembershipGet(...a) }) }),
      }),
    }),
    { FieldValue: { serverTimestamp: () => '__ts' } },
  ),
}));

const { verifyLineConnection } = require('../../integrations/controllers/configController');

const req = (data, token = { roles: {} }) => ({ auth: { uid: 'u1', token }, data });

describe('verifyLineConnection input validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMembershipGet.mockResolvedValue({ empty: true, docs: [] });
  });

  it('rejects unauthenticated callers', async () => {
    await expect(verifyLineConnection({ data: { companyId: 'co1', phoneNumber: '+15551234567' } }))
      .rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('rejects missing companyId / phoneNumber', async () => {
    await expect(verifyLineConnection(req({ companyId: 'co1' })))
      .rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('rejects the bare "+" with an actionable message, before any keychain/db work', async () => {
    await expect(verifyLineConnection(req({ companyId: 'co1', phoneNumber: '+' })))
      .rejects.toMatchObject({ code: 'invalid-argument', message: /valid phone line/i });
    // Must short-circuit before the membership/permission lookup.
    expect(mockMembershipGet).not.toHaveBeenCalled();
  });

  it('rejects other malformed numbers (whitespace/punctuation only)', async () => {
    for (const bad of ['   ', '---', '()']) {
      await expect(verifyLineConnection(req({ companyId: 'co1', phoneNumber: bad })))
        .rejects.toMatchObject({ code: 'invalid-argument' });
    }
    expect(mockMembershipGet).not.toHaveBeenCalled();
  });

  it('lets a VALID number pass validation through to the permission check', async () => {
    // Membership empty + not super admin -> should fail at permission-denied,
    // which proves the validity guard did NOT block a real number.
    await expect(verifyLineConnection(req({ companyId: 'co1', phoneNumber: '+15551234567' })))
      .rejects.toMatchObject({ code: 'permission-denied' });
    expect(mockMembershipGet).toHaveBeenCalledTimes(1);
  });
});
