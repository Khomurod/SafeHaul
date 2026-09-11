jest.mock('firebase-functions/v2/https', () => ({
  onCall: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
  HttpsError: class HttpsError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  },
}));

jest.mock('../../firebaseAdmin', () => {
  const mockRunTransaction = jest.fn();
  const docRefStub = {
    update: jest.fn().mockResolvedValue(undefined),
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({
        delete: jest.fn().mockResolvedValue(undefined),
      })),
    })),
  };
  return {
    admin: {
      firestore: {
        FieldValue: { serverTimestamp: jest.fn(() => ({ __ts: true })) },
      },
    },
    db: {
      runTransaction: (...args) => mockRunTransaction(...args),
      collection: jest.fn(() => ({
        doc: jest.fn(() => ({
          collection: jest.fn(() => ({
            doc: jest.fn(() => docRefStub),
          })),
        })),
      })),
    },
    storage: {
      bucket: jest.fn(() => ({
        file: jest.fn(() => ({ save: jest.fn().mockResolvedValue(undefined) })),
      })),
    },
    mockRunTransaction,
    docRefStub,
  };
});

jest.mock('../../shared/rateLimiter', () => ({
  checkRateLimit: jest.fn().mockResolvedValue(true),
}));

const { submitPublicEnvelope } = require('../../publicSigning');
const firebaseAdmin = require('../../firebaseAdmin');

describe('submitPublicEnvelope', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    firebaseAdmin.mockRunTransaction.mockReset();
    firebaseAdmin.docRefStub.update.mockResolvedValue(undefined);
  });

  function mockTxnEnvelope({
    expired,
    token = 'secret-token',
    status = 'sent',
    fields = [],
  } = {}) {
    const expiresAt = expired
      ? { toMillis: () => Date.now() - 60000 }
      : { toMillis: () => Date.now() + 60000 };
    firebaseAdmin.mockRunTransaction.mockImplementation(async (cb) => {
      let call = 0;
      const txn = {
        get: jest.fn(async () => {
          call += 1;
          if (call === 1) {
            return {
              exists: true,
              data: () => ({
                status,
                expiresAt,
                fields,
              }),
            };
          }
          return {
            exists: true,
            data: () => ({ accessToken: token }),
          };
        }),
        update: jest.fn(),
      };
      return cb(txn);
    });
  }

  const baseReq = {
    data: {
      companyId: 'c1',
      requestId: 'r1',
      accessToken: 'secret-token',
      fieldValues: {},
      auditData: {},
    },
    rawRequest: { headers: {}, ip: '127.0.0.1' },
  };

  it('rejects expired envelopes inside the transaction', async () => {
    mockTxnEnvelope({ expired: true });
    await expect(submitPublicEnvelope(baseReq)).rejects.toMatchObject({
      code: 'deadline-exceeded',
    });
  });

  it('passes expiry check when expiresAt is in the future', async () => {
    mockTxnEnvelope({ expired: false });

    const res = await submitPublicEnvelope(baseReq);
    expect(res.success).toBe(true);
    expect(firebaseAdmin.docRefStub.update).toHaveBeenCalled();
  });

  it('rejects non-object fieldValues payloads', async () => {
    await expect(
      submitPublicEnvelope({
        ...baseReq,
        data: {
          ...baseReq.data,
          fieldValues: 'bad-payload',
        },
      })
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('rejects unknown field ids', async () => {
    mockTxnEnvelope({
      expired: false,
      fields: [
        { id: 'known_field', type: 'text', required: false, defaultValue: '' },
      ],
    });

    await expect(
      submitPublicEnvelope({
        ...baseReq,
        data: {
          ...baseReq.data,
          fieldValues: { unknown_field: 'x' },
        },
      })
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('rejects missing required fields before sealing', async () => {
    mockTxnEnvelope({
      expired: false,
      fields: [
        { id: 'name', type: 'text', label: 'Name', required: true, defaultValue: '' },
      ],
    });

    await expect(
      submitPublicEnvelope({
        ...baseReq,
        data: {
          ...baseReq.data,
          fieldValues: {},
        },
      })
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('allows valid submissions with known fields and required values', async () => {
    mockTxnEnvelope({
      expired: false,
      fields: [
        { id: 'name', type: 'text', label: 'Name', required: true, defaultValue: '' },
      ],
    });

    const res = await submitPublicEnvelope({
      ...baseReq,
      data: {
        ...baseReq.data,
        fieldValues: { name: 'Ada Lovelace' },
      },
    });

    expect(res.success).toBe(true);
    expect(firebaseAdmin.docRefStub.update).toHaveBeenCalled();
  });

  it('accepts a locked required date when client sends empty string; merges defaultValue', async () => {
    // An ordinary locked date — an effective date the sender chose — keeps the
    // value it was sent with. Only a field that MEANS "Date Signed" is restamped,
    // which is what the next describe block is about.
    mockTxnEnvelope({
      expired: false,
      fields: [
        {
          id: 'effective_date',
          type: 'date',
          label: 'Effective Date',
          required: true,
          readOnly: true,
          prefillPolicy: 'locked',
          defaultValue: 'May 7, 2026',
        },
      ],
    });

    const res = await submitPublicEnvelope({
      ...baseReq,
      data: {
        ...baseReq.data,
        fieldValues: { effective_date: '' },
      },
    });

    expect(res.success).toBe(true);
    expect(firebaseAdmin.docRefStub.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'pending_seal',
        fieldValues: expect.objectContaining({ effective_date: 'May 7, 2026' }),
      }),
    );
  });

  // --- Date Signed ---------------------------------------------------------
  // The bug: `current_date` was resolved when the document was created or sent,
  // so a document prepared on 7 May and signed in September printed 7 May. The
  // server is the authority here: whatever the browser displayed or submitted,
  // the stored value — and therefore the sealed PDF — is stamped from the actual
  // submission time.
  describe('Date Signed', () => {
    const SIGNED_ON = new Date('2026-09-11T12:00:00Z');

    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(SIGNED_ON);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    function lastUpdate() {
      const calls = firebaseAdmin.docRefStub.update.mock.calls;
      return calls[calls.length - 1][0];
    }

    it('stamps the day the signer submitted, not the day the document was sent', async () => {
      mockTxnEnvelope({
        expired: false,
        fields: [
          {
            id: 'date_signed',
            type: 'date',
            label: 'Date Signed',
            required: true,
            readOnly: true,
            prefillPolicy: 'locked',
            bindingKey: 'current_date',
            defaultValue: '{{current_date}}',
          },
        ],
      });

      const res = await submitPublicEnvelope({
        ...baseReq,
        data: { ...baseReq.data, fieldValues: { date_signed: '{{current_date}}' } },
      });

      expect(res.success).toBe(true);
      const update = lastUpdate();
      expect(update.fieldValues.date_signed).toBe('September 11, 2026');
      // The record must not keep an unresolved placeholder: the sealer falls back
      // to `defaultValue` whenever a value is absent.
      expect(update.fields[0].defaultValue).toBe('September 11, 2026');
    });

    it('repairs a document that was already sent with the creation date baked in', async () => {
      mockTxnEnvelope({
        expired: false,
        fields: [
          {
            id: 'date_signed',
            type: 'date',
            label: 'Date Signed',
            required: true,
            readOnly: true,
            prefillPolicy: 'locked',
            bindingKey: 'current_date',
            defaultValue: 'May 7, 2026',
          },
        ],
      });

      const res = await submitPublicEnvelope({
        ...baseReq,
        data: { ...baseReq.data, fieldValues: { date_signed: 'May 7, 2026' } },
      });

      expect(res.success).toBe(true);
      expect(lastUpdate().fieldValues.date_signed).toBe('September 11, 2026');
    });

    it('overrides a backdated value a client submitted for that field', async () => {
      mockTxnEnvelope({
        expired: false,
        fields: [
          {
            id: 'date_signed',
            type: 'date',
            label: 'Date Signed',
            required: true,
            prefillPolicy: 'editable',
            bindingKey: 'current_date',
            defaultValue: '{{current_date}}',
          },
        ],
      });

      const res = await submitPublicEnvelope({
        ...baseReq,
        data: { ...baseReq.data, fieldValues: { date_signed: '1999-01-01' } },
      });

      expect(res.success).toBe(true);
      expect(lastUpdate().fieldValues.date_signed).toBe('September 11, 2026');
    });

    it('never reports a deferred Date Signed field as a missing required field', async () => {
      mockTxnEnvelope({
        expired: false,
        fields: [
          {
            id: 'date_signed',
            type: 'date',
            label: 'Date Signed',
            required: true,
            readOnly: true,
            prefillPolicy: 'locked',
            bindingKey: 'current_date',
            defaultValue: '{{current_date}}',
          },
        ],
      });

      // Nothing submitted for it at all — the stamp has to supply the value.
      const res = await submitPublicEnvelope({
        ...baseReq,
        data: { ...baseReq.data, fieldValues: {} },
      });

      expect(res.success).toBe(true);
      expect(lastUpdate().fieldValues.date_signed).toBe('September 11, 2026');
    });

    it('leaves every other date in the same envelope exactly as it was', async () => {
      mockTxnEnvelope({
        expired: false,
        fields: [
          {
            id: 'date_signed',
            type: 'date',
            label: 'Date Signed',
            required: true,
            prefillPolicy: 'locked',
            bindingKey: 'current_date',
            defaultValue: '{{current_date}}',
          },
          { id: 'dob', type: 'text', label: 'Date of Birth', required: true, bindingKey: 'dob', defaultValue: 'January 2, 1980' },
          { id: 'hire_date', type: 'date', label: 'Hire Date', required: true, defaultValue: 'March 1, 2026' },
          { id: 'cdl_exp', type: 'text', label: 'CDL Expiration', required: false, bindingKey: 'cdl_expiration', defaultValue: 'August 30, 2029' },
        ],
      });

      const res = await submitPublicEnvelope({
        ...baseReq,
        data: {
          ...baseReq.data,
          fieldValues: {
            dob: 'January 2, 1980',
            hire_date: 'March 1, 2026',
            cdl_exp: 'August 30, 2029',
          },
        },
      });

      expect(res.success).toBe(true);
      const update = lastUpdate();
      expect(update.fieldValues).toMatchObject({
        date_signed: 'September 11, 2026',
        dob: 'January 2, 1980',
        hire_date: 'March 1, 2026',
        cdl_exp: 'August 30, 2029',
      });
      expect(update.fields.find((f) => f.id === 'dob').defaultValue).toBe('January 2, 1980');
      expect(update.fields.find((f) => f.id === 'hire_date').defaultValue).toBe('March 1, 2026');
    });

    it('keeps what a signer typed into an editable box that merely mentions the date', async () => {
      mockTxnEnvelope({
        expired: false,
        fields: [
          {
            id: 'attestation',
            type: 'text',
            label: 'Attestation',
            required: true,
            prefillPolicy: 'editable',
            defaultValue: 'Ada Lovelace signed on {{current_date}}',
          },
        ],
      });

      await submitPublicEnvelope({
        ...baseReq,
        data: {
          ...baseReq.data,
          fieldValues: { attestation: 'A. Lovelace signed on September 11, 2026' },
        },
      });

      expect(lastUpdate().fieldValues.attestation).toBe('A. Lovelace signed on September 11, 2026');
    });

    it('fills that same box from the server when the signer left it blank', async () => {
      mockTxnEnvelope({
        expired: false,
        fields: [
          {
            id: 'attestation',
            type: 'text',
            label: 'Attestation',
            required: true,
            prefillPolicy: 'editable',
            defaultValue: 'Ada Lovelace signed on {{current_date}}',
          },
        ],
      });

      await submitPublicEnvelope({
        ...baseReq,
        data: { ...baseReq.data, fieldValues: { attestation: '' } },
      });

      expect(lastUpdate().fieldValues.attestation)
        .toBe('Ada Lovelace signed on September 11, 2026');
    });

    it('does not rewrite the stored fields when the envelope has no Date Signed field', async () => {
      mockTxnEnvelope({
        expired: false,
        fields: [{ id: 'name', type: 'text', label: 'Name', required: true, defaultValue: '' }],
      });

      await submitPublicEnvelope({
        ...baseReq,
        data: { ...baseReq.data, fieldValues: { name: 'Ada Lovelace' } },
      });

      expect(lastUpdate()).not.toHaveProperty('fields');
    });
  });
});
