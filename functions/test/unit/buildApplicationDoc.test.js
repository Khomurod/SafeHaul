jest.mock('firebase-functions/v1', () => ({
  https: {
    HttpsError: class HttpsError extends Error {
      constructor(code, message) {
        super(message);
        this.code = code;
      }
    },
  },
}));

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => ({ __srv: true }) },
}));

const {
  assertRequiredUploads,
  buildApplicationDoc,
  generateApplicantKey,
} = require('../../shared/buildApplicationDoc');

describe('buildApplicationDoc', () => {
  it('builds the same deterministic application identity and guest shape', () => {
    const built = buildApplicationDoc({
      companyId: 'co1',
      companyName: 'Tenant Co',
      email: ' DRIVER@Example.COM ',
      phone: '(555) 123-4567',
      signature: 'data:image/png;base64,AAA',
      formData: {
        firstName: 'Ada',
        employers: [{ companyName: 'Carrier', phone: '5551234567' }],
        lifecycle: { clientVersion: '2.0-bulletproof' },
      },
    });

    const expectedKey = generateApplicantKey('co1', ' DRIVER@Example.COM ', '(555) 123-4567');
    expect(built.applicationId).toBe(expectedKey.applicantKey);
    expect(built.applicationDoc).toMatchObject({
      applicantId: expectedKey.applicantKey,
      applicationId: expectedKey.applicantKey,
      driverId: expectedKey.applicantKey,
      userId: expectedKey.applicantKey,
      applicantKeyFull: expectedKey.applicantKeyFull,
      email: 'driver@example.com',
      phone: '(555) 123-4567',
      companyId: 'co1',
      companyName: 'Tenant Co',
      status: 'New Application',
      sourceType: 'Public Application',
      lifecycle: {
        status: 'submitted',
        clientVersion: '2.0-bulletproof',
        isGuest: true,
        processedViaFunction: true,
      },
    });
    expect(built.applicationDoc.updatedAt).toEqual({ __srv: true });
  });

  it('honors provided source metadata', () => {
    const built = buildApplicationDoc({
      companyId: 'co1',
      companyName: 'Tenant Co',
      email: 'a@b.com',
      phone: '5551234567',
      signature: 'data:image/png;base64,AAA',
      formData: {},
      sourceMeta: {
        sourceType: 'Public Application',
        sourceSlug: 'tenant',
        recruiterCode: 'rec1',
        clientVersion: '2.0-bulletproof',
      },
    });
    expect(built.applicationDoc.sourceType).toBe('Public Application');
    expect(built.applicationDoc.sourceSlug).toBe('tenant');
    expect(built.applicationDoc.recruiterCode).toBe('rec1');
    expect(built.applicationDoc.lifecycle.clientVersion).toBe('2.0-bulletproof');
  });

  it('persists normalized search fields from the shared normalizer', () => {
    const built = buildApplicationDoc({
      companyId: 'co1',
      companyName: 'Tenant Co',
      email: ' DRIVER@Example.COM ',
      phone: '+1 (555) 123-4567',
      signature: 'data:image/png;base64,AAA',
      formData: { firstName: '  Ada ', lastName: 'LOVELACE' },
    });

    expect(built.applicationDoc).toMatchObject({
      firstNameNormalized: 'ada',
      lastNameNormalized: 'lovelace',
      fullNameNormalized: 'ada lovelace',
      emailNormalized: 'driver@example.com',
      phoneNormalized: '5551234567',
      applicationIdNormalized: built.applicationId.toLowerCase(),
    });
    expect(built.applicationDoc.confirmationNumberNormalized)
      .toBe(built.confirmationNumber.toUpperCase());
  });

  it('rejects missing required uploads with the existing message shape', () => {
    expect(() => assertRequiredUploads(
      {
        cdlUpload: { hidden: false, required: true },
        medCardUpload: { hidden: false, required: true },
      },
      {}
    )).toThrow(/Missing required uploaded documents: CDL Front, CDL Back, Medical Card/);
  });
});
