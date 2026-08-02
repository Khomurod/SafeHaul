// Backfill tests for saveSmsLineAssignments: a legacy company whose assignments / default
// were saved as raw phone numbers (no line tokens) must get its assignmentLineTokens
// backfilled from the authoritative inventory on save -- so a phone-redacting browser can
// reconnect each saved phone to a line and stop showing "No Direct Line". The backfill must
// be non-destructive (phones unchanged) and must not clobber tokens that already exist.

jest.mock('firebase-functions/v2/https', () => ({
  onCall: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
  HttpsError: class HttpsError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  },
}));

jest.mock('../../integrations/factory', () => ({ getAdapter: jest.fn() }));
jest.mock('../../integrations/encryption', () => ({ encrypt: jest.fn(), decrypt: jest.fn() }));
jest.mock('../../integrations/adapters/ringcentral', () => class {});
jest.mock('../../integrations/adapters/eightbyeight', () => class {});
jest.mock('@ringcentral/sdk', () => ({ SDK: class {} }));
jest.mock('../../shared/companyAccess', () => ({
  assertCompanyAdminStrict: jest.fn().mockResolvedValue(undefined),
}));

let mockDocData;
const mockUpdate = jest.fn().mockResolvedValue();
jest.mock('firebase-admin', () => ({
  firestore: Object.assign(
    () => ({
      collection: () => ({
        doc: () => ({
          collection: () => ({
            doc: () => ({
              get: async () => ({ exists: mockDocData !== null, data: () => mockDocData }),
              update: (...a) => mockUpdate(...a),
            }),
          }),
        }),
      }),
    }),
    { FieldValue: { serverTimestamp: () => '__ts' } },
  ),
}));

const { saveSmsLineAssignments } = require('../../integrations/controllers/configController');

const req = (data) => ({ auth: { uid: 'admin1', token: {} }, data });
const lastUpdate = () => mockUpdate.mock.calls[mockUpdate.mock.calls.length - 1][0];

beforeEach(() => {
  jest.clearAllMocks();
});

describe('saveSmsLineAssignments — legacy token backfill', () => {
  it('backfills assignment + default line tokens from stored phones (non-destructive)', async () => {
    mockDocData = {
      isActive: true,
      provider: 'ringcentral',
      // Legacy inventory: no lineId field, just phone numbers.
      inventory: [
        { phoneNumber: '+15550000001', label: 'Main Number', usageType: 'DirectNumber' },
        { phoneNumber: '+15550000002', label: 'Sofia', usageType: 'DirectNumber' },
      ],
      // Legacy assignment + default saved as raw phones, NO tokens.
      assignments: { uidTom: '+15550000002' },
      defaultPhoneNumber: '+15550000001',
      // assignmentLineTokens / defaultLineToken absent
    };

    const res = await saveSmsLineAssignments(req({ companyId: 'c1', assignmentTokens: {} }));
    expect(res.success).toBe(true);

    const u = lastUpdate();
    // Phones unchanged (non-destructive).
    expect(u.assignments.uidTom).toBe('+15550000002');
    // Token backfilled, and it matches the stable lineId the inventory write assigns to
    // that same line (index 1 = Sofia).
    expect(u.assignmentLineTokens.uidTom).toBeTruthy();
    expect(u.assignmentLineTokens.uidTom).toBe(u.inventory[1].lineId);
    // Default token backfilled to the Main Number line (index 0).
    expect(u.defaultLineToken).toBe(u.inventory[0].lineId);
    // The two lines have distinct stable ids.
    expect(u.inventory[0].lineId).not.toBe(u.inventory[1].lineId);
  });

  it('does not overwrite an assignment token that already exists', async () => {
    mockDocData = {
      inventory: [
        { lineId: 'line_existing', phoneNumber: '+15550000002', label: 'Sofia', usageType: 'DirectNumber' },
      ],
      assignments: { uidTom: '+15550000002' },
      assignmentLineTokens: { uidTom: 'line_existing' },
      defaultPhoneNumber: '',
    };

    await saveSmsLineAssignments(req({ companyId: 'c1', assignmentTokens: {} }));
    const u = lastUpdate();
    expect(u.assignmentLineTokens.uidTom).toBe('line_existing');
  });

  it('leaves an assignment without a matching inventory phone untouched (no bogus token)', async () => {
    mockDocData = {
      inventory: [{ phoneNumber: '+15550000002', label: 'Sofia', usageType: 'DirectNumber' }],
      assignments: { uidTom: '+19998887777' }, // phone not in inventory
      defaultPhoneNumber: '',
    };

    await saveSmsLineAssignments(req({ companyId: 'c1', assignmentTokens: {} }));
    const u = lastUpdate();
    expect(u.assignments.uidTom).toBe('+19998887777'); // unchanged
    expect(u.assignmentLineTokens.uidTom || '').toBe(''); // no fabricated token
  });

  it('still applies an explicit token selection AND backfills the rest', async () => {
    mockDocData = {
      inventory: [
        { phoneNumber: '+15550000001', label: 'Main', usageType: 'DirectNumber' },
        { phoneNumber: '+15550000002', label: 'Sofia', usageType: 'DirectNumber' },
      ],
      assignments: { uidLegacy: '+15550000001' }, // legacy, no token
      defaultPhoneNumber: '',
    };

    // Assign uidNew to Sofia by token (use the lnN compatibility token for index 1).
    await saveSmsLineAssignments(req({ companyId: 'c1', assignmentTokens: { uidNew: 'ln1' } }));
    const u = lastUpdate();
    // New explicit selection resolved to the real phone + stable token.
    expect(u.assignments.uidNew).toBe('+15550000002');
    expect(u.assignmentLineTokens.uidNew).toBe(u.inventory[1].lineId);
    // Legacy assignment also backfilled.
    expect(u.assignmentLineTokens.uidLegacy).toBe(u.inventory[0].lineId);
  });
});
