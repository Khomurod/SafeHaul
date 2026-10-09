import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMagicFillPatchForStep } from './dummyDataGenerator';

const everyPage = () => Array.from({ length: 10 }, (_, index) => getMagicFillPatchForStep(index));

describe('getMagicFillPatchForStep', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-08T15:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('answers the licence page under the names it reads', () => {
    const patch = getMagicFillPatchForStep(2);
    expect(patch).toMatchObject({ cdlClass: 'Class A', cdlNumber: 'TX12345678', cdlExpiration: '2028-12-31' });
    expect(patch).not.toHaveProperty('cdl-class');
    expect(patch).not.toHaveProperty('licenseNumber');
  });

  it('counts its dates from today: the licence stays current, the employer covers the past years', () => {
    vi.setSystemTime(new Date('2031-01-02T15:00:00Z'));
    expect(getMagicFillPatchForStep(2).cdlExpiration).toBe('2033-12-31');
    expect(getMagicFillPatchForStep(5).employers[0]).toMatchObject({ startDate: '2026-01', endDate: '2031-01' });
  });

  it('leaves the agreements, the certification and the signature to the applicant', () => {
    for (const patch of everyPage()) {
      for (const key of ['consent-mvr', 'agreementAcceptances', 'final-certification', 'signature', 'agree-electronic']) {
        expect(patch).not.toHaveProperty(key);
      }
    }
    // The company's own questions, Review and Agreements, in either order.
    expect(everyPage().slice(7)).toEqual([{}, {}, {}]);
  });

  it('attaches made-up documents with no stored file for the page to open', () => {
    const licence = getMagicFillPatchForStep(2);
    for (const field of ['cdl-front', 'cdl-back', 'medical-card-upload']) {
      expect(licence[field]).toEqual({ name: expect.stringMatching(/^sandbox-/) });
    }
  });
});
