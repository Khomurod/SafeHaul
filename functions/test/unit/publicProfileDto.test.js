// A4: guard the REAL public-profile projection (no inline mirror), so a future
// edit that widens the projection or leaks PII fails this test.
const {
  buildPublicProfileDto,
  PUBLIC_APPLICATION_CONFIG_KEYS,
} = require('../../shared/publicProfileDto');

const TS = { __ts: true };

describe('public profile DTO (A4 projection)', () => {
  it('omits internal operational fields', () => {
    const dto = buildPublicProfileDto({
      companyName: 'Acme',
      isActive: false,
      revenue: 99999,
      featureSchedules: { campaignsEnabled: false },
      postApplicationTemplates: [{ id: 'x' }],
      applicationConfig: {
        cdlUpload: { required: true },
        internalOnly: { hidden: true },
      },
      customQuestions: [{ id: 'q1', label: 'Why?' }],
    }, TS);

    expect(dto.companyName).toBe('Acme');
    expect(dto.isActive).toBeUndefined();
    expect(dto.revenue).toBeUndefined();
    expect(dto.featureSchedules).toBeUndefined();
    expect(dto.applicationConfig.internalOnly).toBeUndefined();
    expect(dto.applicationConfig.cdlUpload).toEqual({ required: true });
    expect(dto.customQuestions).toHaveLength(1);
    expect(dto.updatedAt).toBe(TS);
  });

  it('projects post-application templates as a sanitized {templateId,title,enabled,required} subset only', () => {
    const dto = buildPublicProfileDto({
      companyName: 'Acme',
      postApplicationTemplates: [
        { templateId: 't1', title: 'W-9', enabled: true, secretConfig: 'do-not-leak', fields: [{ x: 1 }] },
        { id: 't2', title: 'Handbook' },
        'rawStringId',
        { title: 'no id — dropped' },
        { templateId: 't3', title: 'Survey', required: false },
      ],
    }, TS);

    expect(dto.postApplicationTemplates).toEqual([
      { templateId: 't1', title: 'W-9', enabled: true, required: true },
      { templateId: 't2', title: 'Handbook', enabled: true, required: true },
      { templateId: 'rawStringId', title: 'Complete Form', enabled: true, required: true },
      { templateId: 't3', title: 'Survey', enabled: true, required: false },
    ]);
    // Full template config never leaks.
    expect(JSON.stringify(dto)).not.toMatch(/do-not-leak/);
  });

  it('defaults templates without an explicit required flag to REQUIRED (backward compat)', () => {
    const dto = buildPublicProfileDto({
      companyName: 'Acme',
      postApplicationTemplates: [{ templateId: 'legacy', title: 'Old Config' }],
    }, TS);
    expect(dto.postApplicationTemplates[0].required).toBe(true);
  });

  it('never copies arbitrary PII-looking fields added to the source doc later', () => {
    // Simulate a future schema change that drops sensitive data on the company doc.
    const dto = buildPublicProfileDto({
      companyName: 'Acme',
      ownerSsn: '123-45-6789',
      bankAccount: '00012345',
      internalNotes: 'do not share',
      apiKeys: { ringcentral: 'secret' },
      ownerEmail: 'owner@acme.com',
    }, TS);

    // The projection is an allowlist: only these keys may ever appear.
    expect(Object.keys(dto).sort()).toEqual(
      ['appSlug', 'applicationConfig', 'brandColor', 'companyName', 'customQuestions', 'logoUrl', 'postApplicationTemplates', 'updatedAt'].sort(),
    );
    expect(JSON.stringify(dto)).not.toMatch(/123-45-6789|00012345|do not share|secret|owner@acme.com/);
  });

  it('locks the public applicationConfig allowlist to a known set', () => {
    // If this set changes, a reviewer must confirm the new key is non-PII.
    expect(PUBLIC_APPLICATION_CONFIG_KEYS).toEqual([
      'cdlUpload', 'medCardUpload', 'showEmergencyContacts',
      'ssn', 'dob', 'previousAddresses', 'employers', 'violations', 'accidents',
    ]);
  });

  it('applies safe defaults for a sparse company doc', () => {
    const dto = buildPublicProfileDto({}, TS);
    expect(dto.companyName).toBe('Untitled Company');
    expect(dto.appSlug).toBeNull();
    expect(dto.logoUrl).toBeNull();
    expect(dto.brandColor).toBe('#1e40af');
    expect(dto.applicationConfig).toEqual({});
    expect(dto.customQuestions).toEqual([]);
    expect(dto.postApplicationTemplates).toEqual([]);
  });
});
