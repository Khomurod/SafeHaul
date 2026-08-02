const {
  shouldFireContactAttemptSms,
  templateFieldForStatus,
} = require('../../atsContactSms');

describe('ATS contact SMS transitions', () => {
  it('does not fire when status unchanged', () => {
    expect(
      shouldFireContactAttemptSms({ status: 'New' }, { status: 'New' }),
    ).toBe(false);
    expect(
      shouldFireContactAttemptSms(
        { status: 'Contact Attempt 1' },
        { status: 'Contact Attempt 1' },
      ),
    ).toBe(false);
  });

  it('does not fire when status changes but not to a contact attempt', () => {
    expect(
      shouldFireContactAttemptSms({ status: 'New' }, { status: 'In Process' }),
    ).toBe(false);
  });

  it('fires only on transition into contact attempt stages', () => {
    expect(
      shouldFireContactAttemptSms({ status: 'New' }, { status: 'Contact Attempt 1' }),
    ).toBe(true);
    expect(
      shouldFireContactAttemptSms(
        { status: 'Contact Attempt 1' },
        { status: 'Contact Attempt 2' },
      ),
    ).toBe(true);
  });

  it('maps statuses to template fields', () => {
    expect(templateFieldForStatus('Contact Attempt 1')).toBe('templateContactAttempt1');
    expect(templateFieldForStatus('Contact Attempt 3')).toBe('templateContactAttempt3');
    expect(templateFieldForStatus('In Process')).toBeNull();
  });
});
