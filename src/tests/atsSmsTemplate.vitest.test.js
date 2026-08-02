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
});
