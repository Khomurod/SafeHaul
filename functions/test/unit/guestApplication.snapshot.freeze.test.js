/**
 * What a submission freezes, and that the questions are captured as the driver
 * saw them.
 *
 * Part of the guest-application snapshot suite. The in-memory Firestore, the
 * fixtures and the reset are in `guestApplication.snapshot.support.js`. Each
 * `jest.mock` below has to stay in this file, because Jest hoists it per file
 * and cannot register one from a helper.
 */
jest.mock('firebase-functions/v1', () => require('./guestApplication.snapshot.support').httpsMock());
jest.mock('firebase-admin/firestore', () => require('./guestApplication.snapshot.support').firestoreFieldValueMock());
jest.mock('../../firebaseAdmin', () => require('./guestApplication.snapshot.support').firebaseAdminMock());
jest.mock('../../shared/companyTenant', () => require('./guestApplication.snapshot.support').companyTenantMock());
jest.mock('../../shared/rateLimiter', () => require('./guestApplication.snapshot.support').rateLimiterMock());

const { submitGuestApplication } = require('../../guestApplication');
const {
   mockState, payload, ctx, NO_REQUIRED_UPLOADS, storedSnapshots, onlySnapshot,
   resetSnapshotState,
} = require('./guestApplication.snapshot.support');

beforeEach(resetSnapshotState);

describe('submission freezes a snapshot', () => {
  it('writes the original snapshot as v1 and reports its id', async () => {
    const res = await submitGuestApplication(payload(), ctx);
    expect(res.success).toBe(true);
    expect(res.snapshotId).toBe('v1');
    expect(storedSnapshots()).toHaveLength(1);
    expect(storedSnapshots()[0][0]).toMatch(/\/submission\/v1$/);
  });

  it('stores it under the FINAL application id', async () => {
    const res = await submitGuestApplication(payload(), ctx);
    expect(storedSnapshots()[0][0]).toContain(`/applications/${res.applicationId}/`);
  });

  it('freezes the frozen marker, versions and company identity', async () => {
    await submitGuestApplication(payload(), ctx);
    const snap = onlySnapshot();
    expect(snap.frozen).toBe(true);
    expect(snap.definitionVersion).toMatch(/^[a-f0-9]{16}$/);
    expect(snap.agreementVersion).toBe('v1');
    // Company identity comes from the company document — the public profile
    // deliberately does not expose an address or DOT number.
    expect(snap.company.companyName).toBe('Artificial Freight Co');
    expect(snap.company.dotNumber).toBe('1234567');
    expect(snap.company.address.city).toBe('Springfield');
  });

  it('records the driver answers with real labels', async () => {
    await submitGuestApplication(payload(), ctx);
    const answers = onlySnapshot().sections.flatMap((s) => s.answers);
    const first = answers.find((a) => a.fieldId === 'firstName');
    expect(first.label).toBe('First Name');
    expect(first.displayValue).toBe('Ann');
  });

  it('captures all five agreements — the MVR authorization and the Clearinghouse consent included', async () => {
    await submitGuestApplication(payload(), ctx);
    const ids = onlySnapshot().agreements.map((a) => a.id);
    expect(ids).toEqual(['mvrAuthorization', 'electronicSignature', 'fcraDisclosure', 'pspDisclosure', 'clearinghouseConsent']);
  });

  it('attaches no signature to an agreement with no acceptance evidence', async () => {
    await submitGuestApplication(payload(), ctx);
    // This payload sends no agreementAcceptances at all.
    for (const agreement of onlySnapshot().agreements) {
      expect(agreement.accepted).toBe(false);
      expect(agreement.signature).toBeNull();
      // The wording presented is still recorded.
      expect(agreement.body).toContain('Artificial Freight Co');
    }
  });

  it('records per-agreement acceptance when the client supplies it', async () => {
    await submitGuestApplication(payload({
      agreementAcceptances: {
        // The MVR authorization is accepted on the Motor Vehicle Record step,
        // before the consent-step agreements.
        mvrAuthorization: { accepted: true, acceptedAt: '2026-06-15T11:50:00.000Z' },
        electronicSignature: { accepted: true, acceptedAt: '2026-06-15T12:00:00.000Z' },
        fcraDisclosure: { accepted: true, acceptedAt: '2026-06-15T12:00:01.000Z' },
        pspDisclosure: { accepted: true, acceptedAt: '2026-06-15T12:00:02.000Z' },
        clearinghouseConsent: { accepted: true, acceptedAt: '2026-06-15T12:00:03.000Z' },
      },
    }), ctx);

    const agreements = onlySnapshot().agreements;
    expect(agreements.every((a) => a.accepted === true)).toBe(true);
    expect(agreements.every((a) => a.signature !== null)).toBe(true);
    expect(agreements[0].id).toBe('mvrAuthorization');
    expect(agreements[0].acceptedAt).toBe('2026-06-15T11:50:00.000Z');
    expect(agreements[1].acceptedAt).toBe('2026-06-15T12:00:00.000Z');
  });

  it('records the IP the server observed, not one the client claims', async () => {
    // Acceptance evidence that the accepting party can forge is not evidence.
    await submitGuestApplication(payload({
      agreementAcceptances: {
        electronicSignature: {
          accepted: true,
          acceptedAt: '2026-06-15T12:00:00.000Z',
          ip: '10.0.0.1',                    // forged by the client
          userAgent: 'Mozilla/5.0 (Test)',   // legitimately self-reported
        },
      },
    }), ctx);

    const accepted = onlySnapshot().agreements.find((a) => a.id === 'electronicSignature');
    expect(accepted.acceptanceContext.ip).toBe('203.0.113.1');
    expect(accepted.acceptanceContext.ip).not.toBe('10.0.0.1');
    expect(accepted.acceptanceContext.userAgent).toBe('Mozilla/5.0 (Test)');
  });

  it('stamping does not resurrect acceptance the driver never gave', async () => {
    await submitGuestApplication(payload({
      agreementAcceptances: {
        electronicSignature: { accepted: false, ip: '10.0.0.1' },
      },
    }), ctx);

    const agreements = onlySnapshot().agreements;
    expect(agreements.every((a) => a.accepted === false)).toBe(true);
    expect(agreements.every((a) => a.signature === null)).toBe(true);
  });

  it('stamps owner ids so the driver can read their own snapshot', async () => {
    const res = await submitGuestApplication(payload(), ctx);
    const snap = onlySnapshot();
    expect(snap.applicantId).toBe(res.applicationId);
    expect(snap.driverId).toBe(res.applicationId);
    expect(snap.companyId).toBe('co1');
  });

  it('records employment coverage as computed at submission', async () => {
    await submitGuestApplication(payload({
      employers: [{ startDate: '2020-01', endDate: 'Present', companyName: 'Prior Carrier' }],
    }), ctx);
    expect(onlySnapshot().employmentCoverage.isComplete).toBe(true);
  });

  it('marks the record as a live submission, not a reconstruction', async () => {
    await submitGuestApplication(payload(), ctx);
    expect(onlySnapshot().provenance).toEqual({ source: 'submission', notes: [] });
  });
});

describe('questions are captured as the driver saw them', () => {
  it('prefers the public profile questions, which is what the apply page renders', async () => {
    mockState.publicProfile = {
      companyName: 'Artificial Freight Co',
      applicationConfig: NO_REQUIRED_UPLOADS,
      customQuestions: [{ id: 'q-public', label: 'Public-profile question' }],
    };
    await submitGuestApplication(payload({ customAnswers: { 'q-public': 'Answered' } }), ctx);

    const custom = onlySnapshot().customAnswers;
    expect(custom.map((q) => q.questionId)).toEqual(['q-public']);
    expect(custom[0].label).toBe('Public-profile question');
    expect(custom[0].displayValue).toBe('Answered');
  });

  it('falls back to the company document when there is no public profile', async () => {
    await submitGuestApplication(payload({ customAnswers: { 'q-company': 'Yes' } }), ctx);
    expect(onlySnapshot().customAnswers[0].label).toBe('Company-doc question');
  });

  it('keeps an answer whose question is unknown, without using the id as wording', async () => {
    mockState.publicProfile = { companyName: 'Artificial Freight Co', applicationConfig: NO_REQUIRED_UPLOADS, customQuestions: [] };
    await submitGuestApplication(payload({ customAnswers: { 'deleted-uuid': 'Some answer' } }), ctx);

    const orphan = onlySnapshot().customAnswers.find((a) => a.questionId === 'deleted-uuid');
    expect(orphan.unknownQuestion).toBe(true);
    expect(orphan.label).toBeNull();
    expect(orphan.displayValue).toBe('Some answer');
  });
});
