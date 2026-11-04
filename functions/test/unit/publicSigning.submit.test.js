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
const { checkRateLimit } = require('../../shared/rateLimiter');

describe('submitPublicEnvelope', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    firebaseAdmin.mockRunTransaction.mockReset();
    firebaseAdmin.docRefStub.update.mockResolvedValue(undefined);
    // Clearing keeps implementations, so the recording bucket a case installs is put back here.
    firebaseAdmin.storage.bucket.mockImplementation(() => ({
      file: jest.fn(() => ({ save: jest.fn(async () => undefined) })),
    }));
    checkRateLimit.mockImplementation(async () => true);
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

  it('records the address Google appended, never one the signer put in the header', async () => {
    mockTxnEnvelope({ expired: false });
    await submitPublicEnvelope({
      ...baseReq,
      rawRequest: { headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.9' }, ip: '6.6.6.6' },
    });
    const written = firebaseAdmin.docRefStub.update.mock.calls.at(-1)[0];
    expect(written.auditTrail.ip).toBe('203.0.113.9');
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

    it('seals the day in the signer\'s zone and records the zone it used', async () => {
      // 9:30 pm in Los Angeles on the 11th; already the 12th in UTC.
      jest.setSystemTime(new Date('2026-09-12T04:30:00Z'));
      mockTxnEnvelope({
        expired: false,
        fields: [{ id: 'date_signed', type: 'date', label: 'Date Signed', required: true, readOnly: true, prefillPolicy: 'locked', bindingKey: 'current_date', defaultValue: '{{current_date}}' }],
      });

      await submitPublicEnvelope({
        ...baseReq,
        data: { ...baseReq.data, timeZone: 'America/Los_Angeles', auditData: { timeZone: 'Europe/Paris' }, fieldValues: { date_signed: 'September 30, 2026' } },
      });

      const update = lastUpdate();
      expect(update.fieldValues.date_signed).toBe('September 11, 2026');
      expect(update.fields[0].defaultValue).toBe('September 11, 2026');
      // The zone the server checked and used, never one the audit data claimed.
      expect(update.auditTrail.timeZone).toBe('America/Los_Angeles');
    });

    it('seals the UTC day when the signer\'s page names no zone', async () => {
      jest.setSystemTime(new Date('2026-09-12T04:30:00Z'));
      mockTxnEnvelope({
        expired: false,
        fields: [{ id: 'date_signed', type: 'date', label: 'Date Signed', required: true, readOnly: true, prefillPolicy: 'locked', bindingKey: 'current_date', defaultValue: '{{current_date}}' }],
      });

      await submitPublicEnvelope({ ...baseReq, data: { ...baseReq.data, fieldValues: {} } });

      expect(lastUpdate().fieldValues.date_signed).toBe('September 12, 2026');
      expect(lastUpdate().auditTrail.timeZone).toBe('UTC');
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

  // --- Drawn signatures and initials ---------------------------------------
  // Every id is checked before any image is saved; the images are then saved
  // side by side, at most four at a time, and a failure rolls back only once
  // every save of its wave has settled.
  describe('signature images', () => {
    const flush = () => new Promise((resolve) => setImmediate(resolve));
    const image = (n) => `data:image/png;base64,${Buffer.from(`png-${n}`).toString('base64')}`;
    const pathOf = (key) => `secure_documents/c1/signatures/r1_${key}.png`;
    const imageFields = (ids) => ids.map((id) => ({ id, type: 'signature', required: false }));

    function deferred() {
      let resolve;
      let reject;
      const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
      return { promise, resolve, reject };
    }

    /**
     * Records every save. A held save waits until the test answers it; `releaseAll`
     * answers each one and lets any later save through, so no case leaves a
     * submission pending.
     */
    function recordSaves({ held = false } = {}) {
      const saves = [];
      let holding = held;
      firebaseAdmin.storage.bucket.mockImplementation(() => ({
        file: jest.fn((path) => ({
          save: jest.fn((buffer, options) => {
            const answer = deferred();
            saves.push({ path, buffer, options, ...answer });
            if (!holding) answer.resolve();
            return answer.promise;
          }),
        })),
      }));
      const releaseAll = () => {
        holding = false;
        saves.forEach((save) => save.resolve());
      };
      return { saves, releaseAll };
    }

    function submit(fieldValues) {
      return submitPublicEnvelope({ ...baseReq, data: { ...baseReq.data, fieldValues } });
    }

    const updatesWith = (status) =>
      firebaseAdmin.docRefStub.update.mock.calls.filter(([patch]) => patch.status === status);

    it('saves every drawn signature side by side', async () => {
      mockTxnEnvelope({ fields: imageFields(['sig1', 'sig2']) });
      const { saves, releaseAll } = recordSaves({ held: true });
      const call = submit({ sig1: image(1), sig2: image(2) });
      try {
        await flush();
        expect(saves.map((save) => save.path)).toEqual([pathOf('sig1'), pathOf('sig2')]);
      } finally {
        releaseAll();
        await call.catch(() => {});
      }
      await expect(call).resolves.toEqual({ success: true });
    });

    it('saves at most 4 at a time, and stores all six paths in submitted order', async () => {
      const ids = ['sig1', 'sig2', 'sig3', 'sig4', 'sig5', 'sig6'];
      mockTxnEnvelope({ fields: imageFields(ids) });
      const { saves, releaseAll } = recordSaves({ held: true });
      const call = submit(Object.fromEntries(ids.map((id, n) => [id, image(n)])));
      try {
        await flush();
        expect(saves.map((save) => save.path)).toEqual(ids.slice(0, 4).map(pathOf));

        // The next wave waits for the whole first wave, not for its first answers.
        saves.slice(0, 3).forEach((save) => save.resolve());
        await flush();
        expect(saves).toHaveLength(4);

        saves[3].resolve();
        await flush();
        expect(saves.map((save) => save.path)).toEqual(ids.map(pathOf));
        expect(updatesWith('pending_seal')).toHaveLength(0);
      } finally {
        releaseAll();
        await call.catch(() => {});
      }
      await expect(call).resolves.toEqual({ success: true });
      const [[sealed]] = updatesWith('pending_seal');
      expect(Object.entries(sealed.fieldValues)).toEqual(ids.map((id) => [id, pathOf(id)]));
    });

    it('gives the four places of a wave to images only, keeping every value in submitted order', async () => {
      const submitted = {
        name: 'Ada Lovelace',
        sig1: image(1),
        title: 'Driver',
        sig2: image(2),
        sig3: image(3),
        agree: true,
        sig4: image(4),
        init1: image(5),
      };
      mockTxnEnvelope({ fields: imageFields(Object.keys(submitted)) });
      const { saves, releaseAll } = recordSaves({ held: true });
      const call = submit(submitted);
      try {
        await flush();
        expect(saves.map((save) => save.path)).toEqual(['sig1', 'sig2', 'sig3', 'sig4'].map(pathOf));
      } finally {
        releaseAll();
        await call.catch(() => {});
      }
      await expect(call).resolves.toEqual({ success: true });
      const [[sealed]] = updatesWith('pending_seal');
      expect(Object.entries(sealed.fieldValues)).toEqual([
        ['name', 'Ada Lovelace'],
        ['sig1', pathOf('sig1')],
        ['title', 'Driver'],
        ['sig2', pathOf('sig2')],
        ['sig3', pathOf('sig3')],
        ['agree', true],
        ['sig4', pathOf('sig4')],
        ['init1', pathOf('init1')],
      ]);
    });

    it('rolls back only after every save of the failed wave has settled', async () => {
      mockTxnEnvelope({ fields: imageFields(['sig1', 'sig2']) });
      const { saves, releaseAll } = recordSaves({ held: true });
      const call = submit({ sig1: image(1), sig2: image(2) });
      // Handled at once: it rejects while the case is still looking at the rollback.
      call.catch(() => {});
      try {
        await flush();
        expect(saves).toHaveLength(2);
        saves[1].reject(new Error('storage unavailable'));
        await flush();
        // sig1 could still land: rolling back now would let it overwrite a retry's image.
        expect(updatesWith('sent')).toHaveLength(0);

        saves[0].resolve();
        await flush();
        expect(updatesWith('sent')).toHaveLength(1);
        expect(updatesWith('sent')[0][0]).toMatchObject({ lastError: 'storage unavailable' });
      } finally {
        releaseAll();
        await call.catch(() => {});
      }
      await expect(call).rejects.toMatchObject({ code: 'internal' });
      expect(updatesWith('pending_seal')).toHaveLength(0);
    });

    it('saves nothing when any submitted id is unknown', async () => {
      mockTxnEnvelope({ fields: imageFields(['sig1']) });
      const { saves } = recordSaves();
      await expect(submit({ sig1: image(1), bogus: 'x' })).rejects.toMatchObject({
        code: 'invalid-argument',
        message: 'Invalid field id submitted: bogus',
      });
      expect(saves).toHaveLength(0);
      expect(updatesWith('sent')).toHaveLength(1);
      expect(updatesWith('pending_seal')).toHaveLength(0);
    });

    it('stores each image\'s path as its value', async () => {
      mockTxnEnvelope({
        fields: [...imageFields(['sig1']), { id: 'name', type: 'text', label: 'Name', required: true }],
      });
      const { saves } = recordSaves();
      await expect(submit({ sig1: image(1), name: 'Ada Lovelace' })).resolves.toEqual({ success: true });

      expect(saves).toHaveLength(1);
      expect(saves[0].path).toBe('secure_documents/c1/signatures/r1_sig1.png');
      expect(saves[0].buffer.toString()).toBe('png-1');
      expect(saves[0].options).toEqual({ metadata: { contentType: 'image/png' } });
      const [[sealed]] = updatesWith('pending_seal');
      expect(sealed.fieldValues).toEqual({
        sig1: 'secure_documents/c1/signatures/r1_sig1.png',
        name: 'Ada Lovelace',
      });
    });

    it('rolls back to sent when a save fails', async () => {
      mockTxnEnvelope({ fields: imageFields(['sig1']) });
      firebaseAdmin.storage.bucket.mockImplementation(() => ({
        file: jest.fn(() => ({ save: jest.fn(async () => { throw new Error('storage unavailable'); }) })),
      }));
      await expect(submit({ sig1: image(1) })).rejects.toMatchObject({
        code: 'internal',
        message: 'An error occurred processing your submission. Please try again.',
      });
      expect(updatesWith('sent')).toEqual([[expect.objectContaining({ lastError: 'storage unavailable' })]]);
      expect(updatesWith('pending_seal')).toHaveLength(0);
    });

    it('saves nothing and changes nothing when the submission is refused before it is claimed', async () => {
      const { saves } = recordSaves();
      const refusals = [
        ['resource-exhausted', () => checkRateLimit.mockImplementation(async () => false)],
        ['not-found', () => firebaseAdmin.mockRunTransaction.mockImplementation(async (cb) => cb({
          get: jest.fn(async () => ({ exists: false, data: () => undefined })),
          update: jest.fn(),
        }))],
        ['permission-denied', () => mockTxnEnvelope({ fields: imageFields(['sig1']), token: 'other-token' })],
        ['deadline-exceeded', () => mockTxnEnvelope({ fields: imageFields(['sig1']), expired: true })],
        ['failed-precondition', () => mockTxnEnvelope({ fields: imageFields(['sig1']), status: 'pending_seal' })],
      ];
      for (const [code, arrange] of refusals) {
        checkRateLimit.mockImplementation(async () => true);
        arrange();
        await expect(submit({ sig1: image(1) })).rejects.toMatchObject({ code });
      }
      expect(saves).toHaveLength(0);
      expect(firebaseAdmin.docRefStub.update).not.toHaveBeenCalled();
    });

    it('still refuses a missing required field after the images, and rolls back', async () => {
      mockTxnEnvelope({
        fields: [...imageFields(['sig1']), { id: 'name', type: 'text', label: 'Name', required: true }],
      });
      recordSaves();
      await expect(submit({ sig1: image(1) })).rejects.toMatchObject({
        code: 'failed-precondition',
        message: 'Required fields missing: Name',
      });
      expect(updatesWith('sent')).toHaveLength(1);
      expect(updatesWith('pending_seal')).toHaveLength(0);
    });
  });

  // --- Company signatures --------------------------------------------------
  // The company's image is drawn from the field itself when the document is
  // sealed, so the signer has nothing to put there: a value sent for it is
  // refused before any image of the submission is saved.
  describe('company signatures', () => {
    const drawn = `data:image/png;base64,${Buffer.from('png-ink').toString('base64')}`;
    const fields = [
      { id: 'sig1', type: 'signature', required: true },
      {
        id: 'cs1',
        type: 'company_signature',
        label: 'Company Signature',
        required: false,
        readOnly: true,
        prefillPolicy: 'locked',
        defaultValue: '',
        companySignaturePath: 'secure_documents/c1/originals/company-signatures/stamp.png',
      },
    ];
    let saves;

    beforeEach(() => {
      saves = [];
      firebaseAdmin.storage.bucket.mockImplementation(() => ({
        file: jest.fn((path) => ({ save: jest.fn(async () => { saves.push(path); }) })),
      }));
      mockTxnEnvelope({ fields });
    });

    const submit = (fieldValues) => submitPublicEnvelope({ ...baseReq, data: { ...baseReq.data, fieldValues } });
    const updatesWith = (status) =>
      firebaseAdmin.docRefStub.update.mock.calls.filter(([patch]) => patch.status === status);

    it.each([
      ['a drawn image', drawn],
      ['a Storage path', 'secure_documents/c1/originals/company-signatures/forged.png'],
      ['any text', 'Acme Freight'],
      ['true', true],
    ])('refuses %s sent for it, saving no image of the submission', async (_label, value) => {
      await expect(submit({ sig1: drawn, cs1: value })).rejects.toMatchObject({
        code: 'invalid-argument',
        message: 'Field cs1 is the company\'s signature and cannot be filled in by the signer.',
      });
      expect(saves).toEqual([]);
      expect(updatesWith('pending_seal')).toHaveLength(0);
      expect(updatesWith('sent')).toHaveLength(1);
    });

    it.each([
      ['an empty string, as the signing room seeds every field', ''],
      ['blank text', '  '],
      ['null', null],
    ])('accepts %s for it and stores nothing there', async (_label, value) => {
      await expect(submit({ sig1: drawn, cs1: value })).resolves.toEqual({ success: true });
      expect(saves).toEqual(['secure_documents/c1/signatures/r1_sig1.png']);
      const [[sealed]] = updatesWith('pending_seal');
      expect(sealed.fieldValues).toEqual({ sig1: 'secure_documents/c1/signatures/r1_sig1.png' });
    });

    it('needs nothing for it from the signer', async () => {
      await expect(submit({ sig1: drawn })).resolves.toEqual({ success: true });
      const [[sealed]] = updatesWith('pending_seal');
      expect(sealed.fieldValues).not.toHaveProperty('cs1');
    });

    it('needs nothing from the signer even when it is marked required', async () => {
      mockTxnEnvelope({ fields: [fields[0], { ...fields[1], required: true }] });
      await expect(submit({ sig1: drawn, cs1: '' })).resolves.toEqual({ success: true });
    });
  });
});
