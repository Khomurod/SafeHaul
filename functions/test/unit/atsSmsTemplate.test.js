const { parseAtsSmsTemplate, mentionsApplicationLink } = require('../../shared/atsSmsTemplate');

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

describe('the application link placeholder', () => {
  it('fills {application link} in any case, and nothing for no link', () => {
    const template = 'Apply here: {Application Link} or {APPLICATION LINK}';
    expect(parseAtsSmsTemplate(template, { applicationLink: 'https://app.safehaul.io/apply/af?r=RIL2345' }))
      .toBe('Apply here: https://app.safehaul.io/apply/af?r=RIL2345 or https://app.safehaul.io/apply/af?r=RIL2345');
    expect(parseAtsSmsTemplate('Apply: {application link}', {})).toBe('Apply: ');
  });

  it('writes the link as it is, even with "$&" in it', () => {
    expect(parseAtsSmsTemplate('{application link}', { applicationLink: 'https://jobs.example.com/x$&y' }))
      .toBe('https://jobs.example.com/x$&y');
  });

  it('says whether a template uses it', () => {
    expect(mentionsApplicationLink('Hi {driver name}, apply: {Application link}')).toBe(true);
    expect(mentionsApplicationLink('Hi {driver name}')).toBe(false);
    expect(mentionsApplicationLink(undefined)).toBe(false);
  });
});
