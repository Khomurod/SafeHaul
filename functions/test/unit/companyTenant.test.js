const { assertCompanyAcceptingIntake } = require('../../shared/companyTenant');

function mockCompanyDoc(exists, data) {
  return {
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({
        get: jest.fn().mockResolvedValue({ exists, data: () => data }),
      })),
    })),
  };
}

describe('assertCompanyAcceptingIntake', () => {
  it('throws not-found when companies doc is missing', async () => {
    const db = mockCompanyDoc(false, {});
    await expect(assertCompanyAcceptingIntake(db, 'co1')).rejects.toMatchObject({
      code: 'not-found',
    });
  });

  it('throws failed-precondition when isActive is false', async () => {
    const db = mockCompanyDoc(true, { isActive: false, companyName: 'X' });
    await expect(assertCompanyAcceptingIntake(db, 'co1')).rejects.toMatchObject({
      code: 'failed-precondition',
    });
  });

  it('throws failed-precondition when status is inactive', async () => {
    const db = mockCompanyDoc(true, { status: 'inactive' });
    await expect(assertCompanyAcceptingIntake(db, 'co1')).rejects.toMatchObject({
      code: 'failed-precondition',
    });
  });

  it('returns company data when tenant is active', async () => {
    const db = mockCompanyDoc(true, { companyName: 'Acme', applicationConfig: { a: 1 } });
    const d = await assertCompanyAcceptingIntake(db, 'co1');
    expect(d.companyName).toBe('Acme');
    expect(d.applicationConfig).toEqual({ a: 1 });
  });

  it('returns synthetic sandbox tenant without reading companies/SANDBOX', async () => {
    const db = {
      collection: jest.fn(() => {
        throw new Error('companies collection should not be queried for SANDBOX shortcut');
      }),
    };
    const d = await assertCompanyAcceptingIntake(db, 'SANDBOX');
    expect(d.isActive !== false).toBe(true);
    expect(String(d.companyName)).toContain('Sandbox');
  });
});
