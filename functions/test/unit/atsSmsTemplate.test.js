const { parseAtsSmsTemplate } = require('../../shared/atsSmsTemplate');

describe('parseAtsSmsTemplate', () => {
  it('interpolates driver and user placeholders case-insensitively', () => {
    const out = parseAtsSmsTemplate('Hi {Driver Name}, from {USER NAME}.', {
      driverName: 'Jane Doe',
      userName: 'Recruiter Bob',
    });
    expect(out).toBe('Hi Jane Doe, from Recruiter Bob.');
  });

  it('degrades gracefully when values are missing', () => {
    expect(parseAtsSmsTemplate('Hello {driver name}', {})).toBe('Hello ');
    expect(parseAtsSmsTemplate(null, { driverName: 'x', userName: 'y' })).toBe('');
  });

  it('does not throw on undefined template', () => {
    expect(() => parseAtsSmsTemplate(undefined, { driverName: null, userName: undefined })).not.toThrow();
  });
});
