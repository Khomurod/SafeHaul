// Regression coverage for the DL-4 applicant confirmation email trigger.
// sendDynamicEmail's contract is positional — (companyId, to, subject, html, options) —
// and a past bug passed a single {to, subject, html} object as `to`, silently
// misaddressing every confirmation email. These tests pin the positional contract.

jest.mock('firebase-functions/v2/firestore', () => ({
  onDocumentCreated: (_opts, fn) => fn,
  onDocumentUpdated: (_opts, fn) => fn,
}));

jest.mock('../../firebaseAdmin', () => ({
  db: {
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({ companyName: 'Acme Trucking' }),
        }),
      })),
    })),
  },
}));

jest.mock('../../emailService', () => ({
  sendDynamicEmail: jest.fn().mockResolvedValue({ success: true }),
}));

const { sendDynamicEmail } = require('../../emailService');
const { onNewApplicationEmailConfirmation } = require('../../notificationTriggers');

function buildEvent(overrides = {}) {
  const { params = {}, data = {} } = overrides;
  return {
    params: { companyId: 'co1', appId: 'app12345', ...params },
    data: {
      data: () => ({
        email: 'driver@example.com',
        firstName: 'Jane',
        lastName: 'Doe',
        confirmationNumber: 'CN-42',
        positionApplyingTo: 'Company Driver (Solo)',
        ...data,
      }),
    },
  };
}

describe('onNewApplicationEmailConfirmation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls sendDynamicEmail with positional (companyId, to, subject, html) args', async () => {
    await onNewApplicationEmailConfirmation(buildEvent());

    expect(sendDynamicEmail).toHaveBeenCalledTimes(1);
    const [companyId, to, subject, html] = sendDynamicEmail.mock.calls[0];

    expect(companyId).toBe('co1');
    // The 2nd positional arg MUST be the raw applicant email string — this
    // assertion fails if an options object is ever passed there again.
    expect(typeof to).toBe('string');
    expect(to).toBe('driver@example.com');
    expect(typeof subject).toBe('string');
    expect(subject).toContain('Application Received');
    expect(subject).toContain('Acme Trucking');
    expect(subject).toContain('CN-42');
    expect(typeof html).toBe('string');
    expect(html).toContain('CN-42');
    expect(html).toContain('Jane Doe');
  });

  it('skips silently when the application has no usable email', async () => {
    await onNewApplicationEmailConfirmation(buildEvent({ data: { email: 'not-an-email' } }));
    await onNewApplicationEmailConfirmation(buildEvent({ data: { email: null } }));
    expect(sendDynamicEmail).not.toHaveBeenCalled();
  });

  it('treats email failure as non-fatal (never throws out of the trigger)', async () => {
    sendDynamicEmail.mockRejectedValueOnce(new Error('SMTP down'));
    await expect(onNewApplicationEmailConfirmation(buildEvent())).resolves.toBeUndefined();
  });
});
