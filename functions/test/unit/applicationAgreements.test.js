// The apply page must display the SAME agreement text the snapshot preserves.
// These tests pin that equivalence, the carrier-name precedence it depends on,
// and the fact that all four required agreements — including the FMCSA
// Clearinghouse consent that the old consent screen omitted entirely — are served.

jest.mock('firebase-functions/v1', () => {
  class HttpsError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }
  const https = { HttpsError, onCall: (fn) => fn };
  return { https, runWith: () => ({ https }) };
});

const mockState = { company: null, publicProfile: null, companyThrows: null, publicThrows: null };

jest.mock('../../firebaseAdmin', () => ({
  db: {
    collection: (name) => ({
      doc: () => ({
        async get() {
          if (name === 'companies') {
            if (mockState.companyThrows) throw mockState.companyThrows;
            return mockState.company
              ? { exists: true, data: () => mockState.company }
              : { exists: false, data: () => null };
          }
          if (mockState.publicThrows) throw mockState.publicThrows;
          return mockState.publicProfile
            ? { exists: true, data: () => mockState.publicProfile }
            : { exists: false, data: () => null };
        },
      }),
    }),
  },
}));

let mockRateLimitAllowed = true;
jest.mock('../../shared/rateLimiter', () => ({
  checkRateLimit: jest.fn(async () => mockRateLimitAllowed),
}));

const { getApplicationAgreements } = require('../../applicationAgreements');
const { resolveAgreementSet, requiredAgreementIds } = require('../../shared/legalAgreements');

const ctx = { rawRequest: { ip: '203.0.113.9' } };

describe('getApplicationAgreements', () => {
  beforeEach(() => {
    mockState.company = { companyName: 'Blue Line Freight' };
    mockState.publicProfile = null;
    mockState.companyThrows = null;
    mockState.publicThrows = null;
    mockRateLimitAllowed = true;
  });

  it('serves all four required agreements, including the Clearinghouse consent', async () => {
    const result = await getApplicationAgreements({ companyId: 'co1' }, ctx);
    const ids = result.agreements.map((a) => a.id);

    expect(ids).toEqual(requiredAgreementIds());
    expect(ids).toContain('clearinghouseConsent');
    expect(ids).toHaveLength(4);
  });

  it('serves text byte-identical to what the snapshot will preserve', async () => {
    const result = await getApplicationAgreements({ companyId: 'co1' }, ctx);
    // The exact call buildSubmissionSnapshot resolves through.
    const preserved = resolveAgreementSet({ companyName: 'Blue Line Freight' });

    expect(result.agreements.map((a) => a.body)).toEqual(preserved.map((a) => a.body));
    expect(result.agreements.map((a) => a.title)).toEqual(preserved.map((a) => a.title));
  });

  it('substitutes the carrier name into the served wording', async () => {
    const result = await getApplicationAgreements({ companyId: 'co1' }, ctx);
    expect(result.companyName).toBe('Blue Line Freight');
    expect(result.agreements.some((a) => a.body.includes('Blue Line Freight'))).toBe(true);
  });

  it('prefers the public projection name, matching submitGuestApplication precedence', async () => {
    // guestApplication does: publicData.companyName || companyData.companyName.
    // If these two ever disagree the driver reads one carrier and the snapshot
    // records another, so the precedence is pinned here deliberately.
    mockState.publicProfile = { companyName: 'Blue Line Logistics LLC' };
    const result = await getApplicationAgreements({ companyId: 'co1' }, ctx);
    expect(result.companyName).toBe('Blue Line Logistics LLC');
  });

  it('falls back to the company document when the projection has no name', async () => {
    mockState.publicProfile = { somethingElse: true };
    const result = await getApplicationAgreements({ companyId: 'co1' }, ctx);
    expect(result.companyName).toBe('Blue Line Freight');
  });

  it('still serves agreements when the public projection read fails', async () => {
    mockState.publicThrows = new Error('unavailable');
    const result = await getApplicationAgreements({ companyId: 'co1' }, ctx);
    // Failing the apply page over a projection outage would be worse than
    // using the company document's own name.
    expect(result.companyName).toBe('Blue Line Freight');
    expect(result.agreements).toHaveLength(4);
  });

  it('reports the current agreement version so acceptance can be recorded against it', async () => {
    const result = await getApplicationAgreements({ companyId: 'co1' }, ctx);
    expect(result.agreementVersion).toBe('v1');
    expect(result.agreements.every((a) => a.version === 'v1')).toBe(true);
  });

  it('rejects a missing companyId', async () => {
    await expect(getApplicationAgreements({}, ctx)).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(getApplicationAgreements({ companyId: '   ' }, ctx)).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('rejects when rate limited', async () => {
    mockRateLimitAllowed = false;
    await expect(getApplicationAgreements({ companyId: 'co1' }, ctx))
      .rejects.toMatchObject({ code: 'resource-exhausted' });
  });

  it('serves generic wording for an unknown company rather than failing the page', async () => {
    mockState.company = null;
    const result = await getApplicationAgreements({ companyId: 'nope' }, ctx);
    expect(result.companyName).toBe('Unknown Company');
    expect(result.agreements).toHaveLength(4);
  });

  it('never leaks applicant or internal company data', async () => {
    mockState.company = { companyName: 'Blue Line Freight', ownerEmail: 'boss@x.com', dotNumber: '1234567' };
    const result = await getApplicationAgreements({ companyId: 'co1' }, ctx);

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('boss@x.com');
    expect(Object.keys(result).sort()).toEqual(['agreementVersion', 'agreements', 'companyName']);
  });
});
