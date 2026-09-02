jest.mock('firebase-functions/v1', () => ({
  https: {
    HttpsError: class HttpsError extends Error {
      constructor(code, message, details) {
        super(message);
        this.code = code;
        this.details = details;
      }
    },
  },
}));

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => ({ __srv: true }) },
}));

const {
  assertApplicationRules,
  assertLockedEmployers,
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

describe('assertApplicationRules', () => {
  const lastYear = `${new Date().getFullYear() - 1}-01-15`;
  const nextYear = `${new Date().getFullYear() + 1}-01-15`;
  const clean = { cdlExpiration: nextYear, 'has-violations': 'no', 'has-accidents': 'no' };

  it('lets a submission through under the platform defaults', () => {
    expect(() => assertApplicationRules(undefined, undefined, { ...clean, cdlExpiration: lastYear })).not.toThrow();
  });

  it('refuses what the company blocks, in the wizard\'s own words, and says which page', () => {
    let error;
    try {
      assertApplicationRules({ expiredCdl: 'block' }, undefined, { ...clean, cdlExpiration: lastYear });
    } catch (e) {
      error = e;
    }
    expect(error.code).toBe('invalid-argument');
    expect(error.message).toMatch(/does not meet this carrier's requirements/);
    expect(error.message).toMatch(/expir/i);
    expect(error.details.issues).toEqual([
      { code: 'expired-cdlExpiration', semanticStep: 'license', fieldId: 'cdlExpiration' },
    ]);
  });

  it('does not refuse what the company only warns about', () => {
    expect(() => assertApplicationRules({ expiredCdl: 'warn' }, undefined, { ...clean, cdlExpiration: lastYear })).not.toThrow();
  });

  it('refuses an impossible date regardless of configuration', () => {
    expect(() => assertApplicationRules(undefined, undefined, { ...clean, dob: '1990-02-30' }))
      .toThrow(/invalid|impossible|date/i);
  });

  it('tolerates a missing form', () => {
    expect(() => assertApplicationRules(undefined, undefined, undefined)).not.toThrow();
  });
});

describe('assertLockedEmployers', () => {
  const acme = { companyName: 'Acme Trucking', dotNumber: '123456' };
  const locked = [{ signature: 'dot:123456', companyName: 'Acme Trucking', dotNumber: '123456' }];

  it('is a no-op for the overwhelming majority of submissions, which lock nothing', () => {
    expect(() => assertLockedEmployers([], { employers: [] })).not.toThrow();
    expect(() => assertLockedEmployers(undefined, { employers: [acme] })).not.toThrow();
  });

  it('accepts an application that kept the carrier and filled in the rest', () => {
    expect(() => assertLockedEmployers(locked, {
      employers: [{ ...acme, startDate: '2023-01-01', endDate: '2024-06-30', reasonForLeaving: 'Pay' }],
    })).not.toThrow();
  });

  it('refuses a locked employer that was removed, and says which page to fix', () => {
    let error;
    try {
      assertLockedEmployers(locked, { employers: [{ companyName: 'Somewhere Else' }] });
    } catch (e) {
      error = e;
    }
    expect(error.code).toBe('invalid-argument');
    expect(error.message).toContain('Acme Trucking');
    expect(error.details.issues).toEqual([
      { code: 'locked-employer-missing', semanticStep: 'employment', fieldId: 'employers' },
    ]);
  });

  it('refuses a rewritten identity on a row the carrier locked', () => {
    expect(() => assertLockedEmployers(locked, {
      employers: [{ companyName: 'Not Acme', dotNumber: '123456' }],
    })).toThrow(/cannot be changed/);
  });

  it('tolerates a missing form', () => {
    expect(() => assertLockedEmployers(locked, undefined)).toThrow(/has to stay on it/);
    expect(() => assertLockedEmployers([], undefined)).not.toThrow();
  });
});
