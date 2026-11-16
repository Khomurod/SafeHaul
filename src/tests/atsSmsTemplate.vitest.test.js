import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseAtsSmsTemplate } = require('../../functions/shared/atsSmsTemplate.js');

describe('ATS SMS template parser (vitest)', () => {
  it('interpolates placeholders', () => {
    expect(
      parseAtsSmsTemplate('Hi {driver name} — {user name}', {
        driverName: 'Sam',
        userName: 'Alex',
      }),
    ).toBe('Hi Sam — Alex');
  });

  it('fills the application link the settings page offers', () => {
    expect(
      parseAtsSmsTemplate('Apply: {application link}', {
        applicationLink: 'https://app.safehaul.io/apply/artificial-freight?r=RIL2345',
      }),
    ).toBe('Apply: https://app.safehaul.io/apply/artificial-freight?r=RIL2345');
  });
});
