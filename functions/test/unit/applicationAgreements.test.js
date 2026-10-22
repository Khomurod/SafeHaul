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

const mockState = {
  company: null, publicProfile: null, companyThrows: null, publicThrows: null, wording: {}, wordingThrows: null,
  // Each read's name as it starts, and a gate every read waits on while set.
  started: [], gate: null,
};

jest.mock('../../firebaseAdmin', () => ({
  db: {
    collection: (name) => ({
      doc: () => ({
        async get() {
          mockState.started.push(name);
          if (mockState.gate) await mockState.gate;
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
        // companies/{id}/legal_agreements — the company's own wording versions.
        collection: () => ({
          async get() {
            mockState.started.push('legal_agreements');
            if (mockState.gate) await mockState.gate;
            if (mockState.wordingThrows) throw mockState.wordingThrows;
            return { docs: Object.entries(mockState.wording).map(([id, data]) => ({ id, data: () => data })) };
          },
        }),
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
const { publishWordingVersion } = require('../../shared/companyAgreementWording');

const ctx = { rawRequest: { ip: '203.0.113.9' } };

describe('getApplicationAgreements', () => {
  beforeEach(() => {
    mockState.company = { companyName: 'Blue Line Freight' };
    mockState.publicProfile = null;
    mockState.wording = {};
    mockState.wordingThrows = null;
    mockState.companyThrows = null;
    mockState.publicThrows = null;
    mockState.started = [];
    mockState.gate = null;
    mockRateLimitAllowed = true;
  });

  it('reads the company, its public profile and its own wording side by side', async () => {
    let release;
    mockState.gate = new Promise((resolve) => { release = resolve; });
    const served = getApplicationAgreements({ companyId: 'co1' }, ctx);
    await new Promise((resolve) => setImmediate(resolve));

    expect([...mockState.started].sort()).toEqual(['companies', 'legal_agreements', 'public_profiles']);
    release();
    await expect(served).resolves.toMatchObject({ companyName: 'Blue Line Freight' });
  });

  it('serves all six required agreements to a screen that names the current set', async () => {
    const result = await getApplicationAgreements({ companyId: 'co1', agreementVersion: 'v3' }, ctx);
    const ids = result.agreements.map((a) => a.id);

    expect(result.agreementVersion).toBe('v3');
    expect(ids).toEqual(requiredAgreementIds());
    expect(ids).toContain('clearinghouseConsent');
    expect(ids).toContain('mvrAuthorization');
    expect(ids).toHaveLength(6);
    // The release's per-employer statement travels beside its body.
    expect(result.agreements.find((a) => a.id === 'previousEmployerRelease').employerStatement)
      .toBe('I authorize {{employerName}} to release to Blue Line Freight the information described above.');
    expect(result.agreements.filter((a) => a.employerStatement)).toHaveLength(1);
  });

  // Screens built before v3 ask without a version and cannot present the
  // release's statements: they keep the v2 set they can show.
  it.each([
    ['no version', {}],
    ['an older version', { agreementVersion: 'v1' }],
    ['an unknown version', { agreementVersion: 'v9' }],
  ])('serves the v2 set to a request that names %s', async (_label, extra) => {
    const result = await getApplicationAgreements({ companyId: 'co1', ...extra }, ctx);
    expect(result.agreementVersion).toBe('v2');
    expect(result.agreements.map((a) => a.id)).toEqual(['mvrAuthorization', 'electronicSignature', 'fcraDisclosure', 'pspDisclosure', 'clearinghouseConsent']);
    expect(result.agreements.every((a) => a.version === 'v2' && !('employerStatement' in a))).toBe(true);
  });

  it('says which page presents each agreement, so the MVR step and the consent step split the set', async () => {
    const result = await getApplicationAgreements({ companyId: 'co1' }, ctx);
    const byId = Object.fromEntries(result.agreements.map((a) => [a.id, a.presentedOn]));
    expect(byId.mvrAuthorization).toBe('drivingRecord');
    expect(byId.clearinghouseConsent).toBe('consent');
  });

  it.each([['v2', {}], ['v3', { agreementVersion: 'v3' }]])('serves %s text byte-identical to what the snapshot will preserve', async (version, extra) => {
    const result = await getApplicationAgreements({ companyId: 'co1', ...extra }, ctx);
    // The exact call buildSubmissionSnapshot resolves through.
    const preserved = resolveAgreementSet({ companyName: 'Blue Line Freight', version });

    expect(result.agreements.map((a) => a.body)).toEqual(preserved.map((a) => a.body));
    expect(result.agreements.map((a) => a.title)).toEqual(preserved.map((a) => a.title));
    expect(result.agreements.map((a) => a.employerStatement)).toEqual(preserved.map((a) => a.employerStatement));
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
    expect(result.agreements).toHaveLength(5);
  });

  it('reports the version it served so acceptance can be recorded against it', async () => {
    const result = await getApplicationAgreements({ companyId: 'co1', agreementVersion: 'v3' }, ctx);
    expect(result.agreementVersion).toBe('v3');
    expect(result.agreements.every((a) => a.version === 'v3')).toBe(true);
    // A version's companions travel with it, so the page can show them.
    expect(result.agreements.find((a) => a.id === 'fcraDisclosure').links[0].label)
      .toBe('A Summary of Your Rights Under the Fair Credit Reporting Act');
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
    expect(result.agreements).toHaveLength(5);
  });

  it('serves the company\'s own published wording, at its own version, in place of the platform text', async () => {
    const body = 'I authorize {{companyName}} to obtain my driving record from every licensing state — company wording.';
    mockState.wording = { mvrAuthorization: publishWordingVersion(null, 'mvrAuthorization', body, { createdBy: 'sa', now: '2026-09-02T00:00:00Z' }) };
    const result = await getApplicationAgreements({ companyId: 'co1' }, ctx);
    const mvr = result.agreements.find((a) => a.id === 'mvrAuthorization');
    expect(mvr.version).toMatch(/^c-[0-9a-f]{12}$/);
    expect(mvr.companyWording).toBe(true);
    expect(mvr.body).toBe(body.replace('{{companyName}}', 'Blue Line Freight'));
    // Agreements the company did not customise stay on the platform wording.
    const fcra = result.agreements.find((a) => a.id === 'fcraDisclosure');
    expect(fcra.version).toBe('v2');
    expect(fcra.companyWording).toBe(false);
  });

  it('never leaks applicant or internal company data', async () => {
    mockState.company = { companyName: 'Blue Line Freight', ownerEmail: 'boss@x.com', dotNumber: '1234567' };
    const result = await getApplicationAgreements({ companyId: 'co1' }, ctx);

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('boss@x.com');
    expect(Object.keys(result).sort()).toEqual(['agreementVersion', 'agreements', 'companyName']);
  });
});

describe('a wording read that fails is a failure, not "no company wording" (Codex P1, 2026-09-02)', () => {
  const { loadCompanyAgreementWording } = require('../../applicationAgreements');

  it('rejects as unavailable so the caller retries instead of presenting platform text', async () => {
    mockState.wordingThrows = new Error('UNAVAILABLE: Firestore is down');
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(loadCompanyAgreementWording('co-1')).rejects.toMatchObject({ code: 'unavailable' });
      await expect(getApplicationAgreements({ companyId: 'co-1' }, { rawRequest: { ip: '203.0.113.9' } }))
        .rejects.toMatchObject({ code: 'unavailable' });
    } finally {
      spy.mockRestore();
    }
  });
});
