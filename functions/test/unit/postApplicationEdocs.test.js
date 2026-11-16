jest.mock('firebase-functions/v2/https', () => ({
  onCall: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
  HttpsError: class HttpsError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  },
}));

// --- Firestore mocks -------------------------------------------------------
// The callable resolves companies/{id}/signing_requests/{deterministicId} and
// its secrets/token subdoc inside a transaction. The mocks below distinguish
// the two refs by identity so txn.get can serve the right snapshot.

const mockApplicationGet = jest.fn();
const mockTemplateGet = jest.fn();
const mockPublicProfileGet = jest.fn();
const mockRequestTxnGet = jest.fn();
const mockTokenTxnGet = jest.fn();
const mockTxnSet = jest.fn();
const mockTxnUpdate = jest.fn();

const mockTokenRef = { __kind: 'token' };
let mockLastRequestDocId = null;
const mockRequestRef = {
  get id() { return mockLastRequestDocId; },
  collection: jest.fn(),
};

// Jest 30's reset leaves every double returning undefined, so the Firestore
// doubles' implementations are named here and put back before each test.
function mockCollection(name) {
  if (name === 'public_profiles') {
    return {
      doc: jest.fn(() => ({
        get: mockPublicProfileGet,
      })),
    };
  }
  if (name === 'companies') {
    return {
      doc: jest.fn(() => ({
        collection: jest.fn((sub) => {
          if (sub === 'applications') {
            return { doc: jest.fn(() => ({ get: mockApplicationGet })) };
          }
          if (sub === 'templates') {
            return { doc: jest.fn(() => ({ get: mockTemplateGet })) };
          }
          if (sub === 'signing_requests') {
            return {
              doc: jest.fn((id) => {
                mockLastRequestDocId = id;
                return mockRequestRef;
              }),
            };
          }
          return { doc: jest.fn() };
        }),
      })),
    };
  }
  return { doc: jest.fn() };
}

const mockRunTransaction = async (fn) => fn({
  get: jest.fn(async (ref) => (ref === mockTokenRef ? mockTokenTxnGet() : mockRequestTxnGet())),
  set: mockTxnSet,
  update: mockTxnUpdate,
});

jest.mock('../../firebaseAdmin', () => ({
  admin: {
    firestore: {
      FieldValue: { serverTimestamp: jest.fn() },
      Timestamp: { fromMillis: jest.fn() },
    },
  },
  db: { collection: jest.fn(), runTransaction: jest.fn() },
}));

jest.mock('../../shared/rateLimiter', () => ({
  checkRateLimit: jest.fn(),
}));

jest.mock('../../shared/companyTenant', () => ({
  assertCompanyAcceptingIntake: jest.fn(),
}));

const { createPostApplicationSigningRequest, __private } = require('../../postApplicationEdocs');
const { checkRateLimit } = require('../../shared/rateLimiter');
const { assertCompanyAcceptingIntake } = require('../../shared/companyTenant');
const { admin, db } = require('../../firebaseAdmin');

const requestPayloadFromTxnSet = () => {
  const call = mockTxnSet.mock.calls.find(([ref]) => ref === mockRequestRef);
  return call ? call[1] : null;
};

const tokenPayloadFromTxnSet = () => {
  const call = mockTxnSet.mock.calls.find(([ref]) => ref === mockTokenRef);
  return call ? call[1] : null;
};

describe('createPostApplicationSigningRequest', () => {
  const baseReq = {
    data: {
      companyId: 'co1',
      applicationId: 'app1',
      confirmationNumber: 'SAF-2026-ABCDE',
      templateId: 'tpl1',
      appBaseUrl: 'https://truckerapp-system.web.app',
    },
    rawRequest: { ip: '203.0.113.10' },
  };

  beforeEach(() => {
    jest.resetAllMocks();
    mockRequestRef.collection.mockImplementation(() => ({ doc: jest.fn(() => mockTokenRef) }));
    admin.firestore.FieldValue.serverTimestamp.mockImplementation(() => ({ __ts: true }));
    admin.firestore.Timestamp.fromMillis.mockImplementation((n) => ({ __millis: n, toMillis: () => n }));
    db.collection.mockImplementation(mockCollection);
    db.runTransaction.mockImplementation(mockRunTransaction);
    checkRateLimit.mockResolvedValue(true);
    assertCompanyAcceptingIntake.mockResolvedValue({ companyName: 'Demo Co', isActive: true });
    mockLastRequestDocId = null;
    mockPublicProfileGet.mockResolvedValue({
      exists: true,
      data: () => ({
        companyName: 'Demo Logistics',
        postApplicationTemplates: [{ templateId: 'tpl1', title: 'W-9', enabled: true }],
      }),
    });
    mockApplicationGet.mockResolvedValue({
      exists: true,
      data: () => ({
        confirmationNumber: 'SAF-2026-ABCDE',
        firstName: 'Anthony',
        lastName: 'Collins',
        email: 'driver@example.com',
        phone: '5551112222',
        street: '2221 MEADECROFT RD',
        city: 'CHARLOTTE',
        state: 'NC',
        zip: '28214',
      }),
    });
    mockTemplateGet.mockResolvedValue({
      exists: true,
      data: () => ({
        title: 'W-9 Form',
        storagePath: 'secure_documents/co1/templates/w9.pdf',
        fields: [
          { id: 'f1', type: 'text', required: true, defaultValue: '{{first_name}} {Last_name}' },
          { id: 'f2', type: 'text', required: true, bindingKey: 'email', defaultValue: '' },
          { id: 'sig', type: 'signature', required: true, defaultValue: '' },
        ],
      }),
    });
    // Default: no pre-existing signing request / token.
    mockRequestTxnGet.mockResolvedValue({ exists: false, data: () => null });
    mockTokenTxnGet.mockResolvedValue({ exists: false, data: () => null });
  });

  it('creates a signing request with resolved placeholders under a deterministic id', async () => {
    const res = await createPostApplicationSigningRequest(baseReq);

    expect(res.success).toBe(true);
    expect(res.requestId).toBe('postapp_app1_tpl1');
    expect(res.accessToken).toBeTruthy();
    expect(res.alreadyCompleted).toBeUndefined();

    const requestPayload = requestPayloadFromTxnSet();
    expect(requestPayload.title).toBe('W-9 Form');
    expect(requestPayload.source).toBe('post_application_success');
    expect(requestPayload.sourceApplicationId).toBe('app1');
    expect(requestPayload.sourceConfirmationNumber).toBe('SAF-2026-ABCDE');
    expect(requestPayload.fields.find((f) => f.id === 'f1').defaultValue).toBe('Anthony Collins');
    expect(requestPayload.fields.find((f) => f.id === 'f2').defaultValue).toBe('driver@example.com');
    expect(checkRateLimit).toHaveBeenCalled();
    expect(assertCompanyAcceptingIntake).toHaveBeenCalledWith(expect.anything(), 'co1');
  });

  it('never stores the access token on the request doc — secrets subdoc only', async () => {
    const res = await createPostApplicationSigningRequest(baseReq);
    const requestPayload = requestPayloadFromTxnSet();
    expect(requestPayload.accessToken).toBeUndefined();
    expect(JSON.stringify(requestPayload)).not.toContain(res.accessToken);
    expect(tokenPayloadFromTxnSet()).toEqual({ accessToken: res.accessToken });
  });

  it('repeated clicks reuse the pending request and token (no duplicates)', async () => {
    mockRequestTxnGet.mockResolvedValue({
      exists: true,
      data: () => ({
        status: 'sent',
        title: 'W-9 Form',
        expiresAt: { toMillis: () => Date.now() + 60000 },
      }),
    });
    mockTokenTxnGet.mockResolvedValue({
      exists: true,
      data: () => ({ accessToken: 'existing-token-123' }),
    });

    const res = await createPostApplicationSigningRequest(baseReq);
    expect(res.requestId).toBe('postapp_app1_tpl1');
    expect(res.accessToken).toBe('existing-token-123');
    expect(mockTxnSet).not.toHaveBeenCalled();
    expect(mockTxnUpdate).not.toHaveBeenCalled();
  });

  it('reports alreadyCompleted (without any token) once the document is signed', async () => {
    mockRequestTxnGet.mockResolvedValue({
      exists: true,
      data: () => ({ status: 'signed', title: 'W-9 Form' }),
    });

    const res = await createPostApplicationSigningRequest(baseReq);
    expect(res.alreadyCompleted).toBe(true);
    expect(res.requestId).toBe('postapp_app1_tpl1');
    expect(res.accessToken).toBeUndefined();
    expect(mockTxnSet).not.toHaveBeenCalled();
  });

  it('re-issues a fresh token when the pending link has expired', async () => {
    mockRequestTxnGet.mockResolvedValue({
      exists: true,
      data: () => ({
        status: 'sent',
        title: 'W-9 Form',
        expiresAt: { toMillis: () => Date.now() - 60000 },
      }),
    });
    mockTokenTxnGet.mockResolvedValue({
      exists: true,
      data: () => ({ accessToken: 'stale-token' }),
    });

    const res = await createPostApplicationSigningRequest(baseReq);
    expect(res.accessToken).toBeTruthy();
    expect(res.accessToken).not.toBe('stale-token');
    expect(mockTxnUpdate).toHaveBeenCalledWith(mockRequestRef, expect.objectContaining({ status: 'sent' }));
    expect(tokenPayloadFromTxnSet()).toEqual({ accessToken: res.accessToken });
  });

  it('re-issues a token when the secrets doc is missing on a pending request', async () => {
    mockRequestTxnGet.mockResolvedValue({
      exists: true,
      data: () => ({
        status: 'sent',
        title: 'W-9 Form',
        expiresAt: { toMillis: () => Date.now() + 60000 },
      }),
    });
    mockTokenTxnGet.mockResolvedValue({ exists: false, data: () => null });

    const res = await createPostApplicationSigningRequest(baseReq);
    expect(res.accessToken).toBeTruthy();
    expect(tokenPayloadFromTxnSet()).toEqual({ accessToken: res.accessToken });
  });

  it('rejects voided documents with a clear failed-precondition', async () => {
    mockRequestTxnGet.mockResolvedValue({
      exists: true,
      data: () => ({ status: 'voided' }),
    });
    await expect(createPostApplicationSigningRequest(baseReq)).rejects.toMatchObject({
      code: 'failed-precondition',
    });
  });

  it('rejects when the company is invalid / not accepting intake', async () => {
    const { HttpsError } = require('firebase-functions/v2/https');
    assertCompanyAcceptingIntake.mockRejectedValueOnce(new HttpsError('not-found', 'Company not found.'));
    await expect(createPostApplicationSigningRequest(baseReq)).rejects.toMatchObject({
      code: 'not-found',
    });
  });

  it('rejects when rate limit blocks request', async () => {
    checkRateLimit.mockResolvedValueOnce(false);
    await expect(createPostApplicationSigningRequest(baseReq)).rejects.toMatchObject({
      code: 'resource-exhausted',
    });
  });

  it('rejects when application record is missing', async () => {
    mockApplicationGet.mockResolvedValueOnce({ exists: false, data: () => null });
    await expect(createPostApplicationSigningRequest(baseReq)).rejects.toMatchObject({
      code: 'not-found',
    });
  });

  it('rejects when confirmation number does not match application', async () => {
    mockApplicationGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ confirmationNumber: 'SAF-2026-ZZZZZ' }),
    });
    await expect(createPostApplicationSigningRequest(baseReq)).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  it('rejects when template document does not exist', async () => {
    mockTemplateGet.mockResolvedValueOnce({ exists: false, data: () => null });
    await expect(createPostApplicationSigningRequest(baseReq)).rejects.toMatchObject({
      code: 'not-found',
    });
  });

  it('rejects when template storagePath is missing', async () => {
    mockTemplateGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ title: 'Broken Template', fields: [] }),
    });
    await expect(createPostApplicationSigningRequest(baseReq)).rejects.toMatchObject({
      code: 'failed-precondition',
    });
  });

  it('supports legacy string list in postApplicationTemplates config', async () => {
    mockPublicProfileGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        postApplicationTemplates: ['tpl1'],
      }),
    });
    const res = await createPostApplicationSigningRequest(baseReq);
    expect(res.success).toBe(true);
  });

  it('leaves the signing date unresolved so it is stamped when the driver signs', async () => {
    // A follow-up document is created the instant an application is submitted and
    // may be signed days later. Resolving `current_date` here is what printed the
    // submission date on a document signed a week afterwards.
    mockTemplateGet.mockResolvedValue({
      exists: true,
      data: () => ({
        title: 'W-9 Form',
        storagePath: 'secure_documents/co1/templates/w9.pdf',
        fields: [
          {
            id: 'date_signed',
            type: 'date',
            required: true,
            readOnly: true,
            bindingKey: 'current_date',
            defaultValue: '{{current_date}}',
          },
          // The single-brace spelling this callable also supports, inside text.
          { id: 'attested', type: 'text', required: false, defaultValue: '{first_name} signed on {current_date}' },
          { id: 'name', type: 'text', required: false, defaultValue: '{{first_name}} {{last_name}}' },
        ],
      }),
    });

    const res = await createPostApplicationSigningRequest(baseReq);
    expect(res.success).toBe(true);

    const payload = requestPayloadFromTxnSet();
    const dateSigned = payload.fields.find((f) => f.id === 'date_signed');
    expect(dateSigned.defaultValue).toBe('{{current_date}}');
    // Deferred, not missing: the field is still locked and still sendable.
    expect(dateSigned.readOnly).toBe(true);
    // Ordinary application data is still resolved at creation, exactly as before.
    expect(payload.fields.find((f) => f.id === 'attested').defaultValue)
      .toBe('Anthony signed on {{current_date}}');
    // Nothing pretends a value that depends on the signing date already exists,
    // while everything that is genuinely known is seeded as before.
    expect(payload.fieldValues).not.toHaveProperty('date_signed');
    expect(payload.fieldValues).not.toHaveProperty('attested');
    expect(payload.fieldValues.name).toBe('Anthony Collins');
  });

  it('marks locked fields readOnly when value is prefilled', async () => {
    mockTemplateGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        title: 'DD Form',
        storagePath: 'secure_documents/co1/templates/dd.pdf',
        fields: [
          {
            id: 'full_name',
            type: 'text',
            required: true,
            prefillPolicy: 'locked',
            bindingKey: 'full_name',
            defaultValue: '',
          },
        ],
      }),
    });
    await createPostApplicationSigningRequest(baseReq);
    const requestPayload = requestPayloadFromTxnSet();
    expect(requestPayload.fields[0].defaultValue).toBe('Anthony Collins');
    expect(requestPayload.fields[0].readOnly).toBe(true);
  });

  it('rejects templates that are not enabled on public profile', async () => {
    mockPublicProfileGet.mockResolvedValue({
      exists: true,
      data: () => ({
        postApplicationTemplates: [{ templateId: 'other_template', enabled: true }],
      }),
    });

    await expect(createPostApplicationSigningRequest(baseReq)).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  it('rejects locked required fields with missing prefill', async () => {
    mockTemplateGet.mockResolvedValue({
      exists: true,
      data: () => ({
        title: 'Direct Deposit',
        storagePath: 'secure_documents/co1/templates/dd.pdf',
        fields: [
          {
            id: 'acct_name',
            type: 'text',
            required: true,
            prefillPolicy: 'locked',
            bindingKey: 'bank_account_name',
            defaultValue: '',
          },
        ],
      }),
    });

    await expect(createPostApplicationSigningRequest(baseReq)).rejects.toMatchObject({
      code: 'failed-precondition',
    });
  });

  // A document sent on its own has no step where someone adds the company's
  // image, so the template must carry it, like a locked required prefill.
  describe('company signatures', () => {
    const IMAGE = 'secure_documents/co1/originals/company-signatures/stamp.png';
    const companyField = (companySignaturePath) => ({
      id: 'cs1',
      type: 'company_signature',
      label: 'Company Signature',
      pageNumber: 1,
      xPosition: 60,
      yPosition: 70,
      width: 30,
      height: 10,
      required: false,
      readOnly: true,
      prefillPolicy: 'locked',
      bindingKey: '',
      prefillGroupKey: '',
      defaultValue: '',
      fontSize: 'Auto',
      companySignaturePath,
    });
    const templateWith = (field) => mockTemplateGet.mockResolvedValue({
      exists: true,
      data: () => ({
        title: 'Offer Letter',
        storagePath: 'secure_documents/co1/templates/offer.pdf',
        fields: [{ id: 'sig', type: 'signature', required: true, defaultValue: '' }, field],
      }),
    });

    it.each([
      ['no image', undefined],
      ['an empty image path', ''],
      ['another company\'s image', 'secure_documents/co2/originals/company-signatures/stamp.png'],
      ['a file outside the company-signatures folder', 'secure_documents/co1/templates/stamp.png'],
    ])('refuses a template whose company signature has %s, writing nothing', async (_label, path) => {
      templateWith(companyField(path));
      await expect(createPostApplicationSigningRequest(baseReq)).rejects.toMatchObject({
        code: 'failed-precondition',
        message: 'Template has a company signature with no image: Company Signature',
      });
      expect(mockTxnSet).not.toHaveBeenCalled();
    });

    it('carries the template\'s image to the document, unchanged', async () => {
      templateWith(companyField(IMAGE));
      await createPostApplicationSigningRequest(baseReq);

      const requestPayload = requestPayloadFromTxnSet();
      expect(requestPayload.fields.find((f) => f.id === 'cs1')).toEqual(companyField(IMAGE));
      expect(requestPayload.fieldValues).not.toHaveProperty('cs1');
    });
  });

  it('rejects invalid arguments before any writes', async () => {
    await expect(
      createPostApplicationSigningRequest({
        ...baseReq,
        data: { ...baseReq.data, companyId: '' },
      })
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(mockTxnSet).not.toHaveBeenCalled();
  });
});

// A follow-up document is sealed and the whole team can read it, so a template
// token fills only from the application fields listed for it; never from the
// SSN, the signature, the consents, ids or anything else the application holds.
// All values below are artificial.
describe('the application fields a template token may name', () => {
  const SSN = '123-45-6789';
  const SIGNATURE = 'TEXT_SIGNATURE:Anthony Collins';
  const application = {
    confirmationNumber: 'SAF-2026-ABCDE',
    firstName: 'Anthony',
    middleName: 'Lee',
    lastName: 'Collins',
    suffix: 'Jr.',
    email: 'driver@example.com',
    phone: '5551112222',
    street: '2221 MEADECROFT RD',
    city: 'CHARLOTTE',
    state: 'NC',
    zip: '28214',
    dob: '1980-04-02',
    cdlNumber: 'N1234567',
    cdlState: 'NC',
    cdlClass: 'A',
    cdlExpiration: '2028-05-01',
    medCardExpiration: '2027-01-15',
    // Never a token: personal, consent, identity and link data.
    ssn: SSN,
    signature: SIGNATURE,
    signatureType: 'typed',
    signatureDate: '2026-11-04',
    'final-certification': 'agreed',
    'agree-electronic': 'yes',
    'sms-consent': 'yes',
    identityKey: 'hmac-abc123',
    applicantKey: 'key-abc123',
    applicantId: 'uid-abc123',
    inviteToken: 'invite-1',
    agreementVersion: 'v3',
    status: 'New Application',
    companyId: 'co1',
  };
  const { buildPrefillContextFromApplication } = __private;
  const { SUPPORTED_BINDING_KEYS } = require('../../shared/edocFieldSemantics');

  const templateWithFields = (fields) => mockTemplateGet.mockResolvedValue({
    exists: true,
    data: () => ({ title: 'Release', storagePath: 'secure_documents/co1/templates/release.pdf', fields }),
  });

  beforeEach(() => {
    jest.resetAllMocks();
    mockRequestRef.collection.mockImplementation(() => ({ doc: jest.fn(() => mockTokenRef) }));
    admin.firestore.FieldValue.serverTimestamp.mockImplementation(() => ({ __ts: true }));
    admin.firestore.Timestamp.fromMillis.mockImplementation((n) => ({ __millis: n, toMillis: () => n }));
    db.collection.mockImplementation(mockCollection);
    db.runTransaction.mockImplementation(mockRunTransaction);
    checkRateLimit.mockResolvedValue(true);
    assertCompanyAcceptingIntake.mockResolvedValue({ companyName: 'Demo Co', isActive: true });
    mockPublicProfileGet.mockResolvedValue({
      exists: true,
      data: () => ({ companyName: 'Demo Logistics', postApplicationTemplates: [{ templateId: 'tpl1', enabled: true }] }),
    });
    mockApplicationGet.mockResolvedValue({ exists: true, data: () => application });
    mockRequestTxnGet.mockResolvedValue({ exists: false, data: () => null });
    mockTokenTxnGet.mockResolvedValue({ exists: false, data: () => null });
  });

  const req = {
    data: { companyId: 'co1', applicationId: 'app1', confirmationNumber: 'SAF-2026-ABCDE', templateId: 'tpl1' },
    rawRequest: { ip: '203.0.113.10' },
  };

  it.each([
    'ssn', 'SSN', 'signature', 'signature_type', 'signature_date', 'final_certification',
    'agree_electronic', 'sms_consent', 'identity_key', 'applicant_key', 'applicant_id',
    'invite_token', 'confirmation_number', 'agreement_version', 'status', 'company_id',
  ])('{{%s}} fills nothing, in any spelling or binding, and reaches no stored field', async (token) => {
    templateWithFields([
      { id: 'double', type: 'text', required: false, defaultValue: `SSN: {{${token}}}` },
      { id: 'single', type: 'text', required: false, defaultValue: `{${token}}` },
      { id: 'bound', type: 'text', required: false, bindingKey: token, defaultValue: '' },
    ]);

    await createPostApplicationSigningRequest(req);
    const payload = requestPayloadFromTxnSet();
    const value = (id) => payload.fields.find((f) => f.id === id).defaultValue;

    expect([value('double'), value('single'), value('bound')]).toEqual(['SSN: ', '', '']);
    expect(JSON.stringify(payload)).not.toContain(SSN);
    expect(JSON.stringify(payload)).not.toContain(SIGNATURE);
  });

  it('refuses a template whose locked required field asks for the SSN, writing nothing', async () => {
    templateWithFields([{ id: 'ssn', type: 'text', required: true, prefillPolicy: 'locked', bindingKey: 'ssn', defaultValue: '', label: 'SSN' }]);

    await expect(createPostApplicationSigningRequest(req)).rejects.toMatchObject({
      code: 'failed-precondition',
      message: 'Template has locked required fields missing prefill values: SSN',
    });
    expect(mockTxnSet).not.toHaveBeenCalled();
  });

  it('every binding the editor offers still fills, by binding and by token', async () => {
    const expected = {
      full_name: 'Anthony Collins',
      first_name: 'Anthony',
      last_name: 'Collins',
      email: 'driver@example.com',
      phone: '5551112222',
      company_name: 'Demo Logistics',
      address: '2221 MEADECROFT RD',
      city: 'CHARLOTTE',
      state: 'NC',
      zip: '28214',
      // Stamped when the driver signs, not now.
      current_date: '{{current_date}}',
    };
    // The list the editor's "Prefill binding" picker offers (mirrored in src/).
    expect(SUPPORTED_BINDING_KEYS.slice().sort()).toEqual(Object.keys(expected).sort());
    templateWithFields(SUPPORTED_BINDING_KEYS.flatMap((key) => [
      { id: `bound_${key}`, type: 'text', required: false, bindingKey: key, defaultValue: '' },
      { id: `token_${key}`, type: 'text', required: false, defaultValue: `{{${key}}}` },
    ]));

    await createPostApplicationSigningRequest(req);
    const payload = requestPayloadFromTxnSet();
    for (const [key, value] of Object.entries(expected)) {
      expect([key, payload.fields.find((f) => f.id === `bound_${key}`).defaultValue]).toEqual([key, value]);
      expect([key, payload.fields.find((f) => f.id === `token_${key}`).defaultValue]).toEqual([key, value]);
    }
  });

  it('holds exactly the listed fields, from where the application keeps them', () => {
    const context = buildPrefillContextFromApplication(application, 'Demo Logistics');
    const { current_date: signingDate, date, ...rest } = context;

    expect(signingDate).toBe('\u0000signed_date\u0000');
    expect(date).toEqual(expect.any(String));
    expect(rest).toEqual({
      full_name: 'Anthony Collins',
      name: 'Anthony Collins',
      first_name: 'Anthony',
      middle_name: 'Lee',
      last_name: 'Collins',
      suffix: 'Jr.',
      email: 'driver@example.com',
      phone: '5551112222',
      company_name: 'Demo Logistics',
      address: '2221 MEADECROFT RD',
      street: '2221 MEADECROFT RD',
      city: 'CHARLOTTE',
      state: 'NC',
      zip: '28214',
      dob: '1980-04-02',
      cdl_number: 'N1234567',
      cdl_state: 'NC',
      cdl_class: 'A',
      cdl_expiration: '2028-05-01',
      med_card_expiration: '2027-01-15',
    });
  });

  it('reads the phone from phoneNumber when phone is absent, and an absent field as empty', () => {
    const context = buildPrefillContextFromApplication({ firstName: 'Ana', phoneNumber: '5550001111' });

    expect(context.phone).toBe('5550001111');
    expect(context.cdl_number).toBe('');
    expect(context.med_card_expiration).toBe('');
  });
});

describe('normalizePostSubmitTemplateConfig — required backward compatibility', () => {
  const { normalizePostSubmitTemplateConfig, buildPostApplicationRequestId } = __private;

  it('legacy strings and objects without a flag default to required', () => {
    const out = normalizePostSubmitTemplateConfig(['tpl1', { templateId: 'tpl2', enabled: true }]);
    expect(out).toEqual([
      expect.objectContaining({ templateId: 'tpl1', enabled: true, required: true }),
      expect.objectContaining({ templateId: 'tpl2', enabled: true, required: true }),
    ]);
  });

  it('explicit required:false is honored', () => {
    const [tpl] = normalizePostSubmitTemplateConfig([{ templateId: 'tpl1', required: false }]);
    expect(tpl.required).toBe(false);
  });

  it('preserves order (explicit order field, index fallback)', () => {
    const out = normalizePostSubmitTemplateConfig([
      { templateId: 'a' },
      { templateId: 'b', order: 9 },
    ]);
    expect(out[0].order).toBe(0);
    expect(out[1].order).toBe(9);
  });

  it('buildPostApplicationRequestId is deterministic per application+template', () => {
    expect(buildPostApplicationRequestId('app1', 'tpl1')).toBe('postapp_app1_tpl1');
    expect(buildPostApplicationRequestId('app1', 'tpl1')).toBe(buildPostApplicationRequestId('app1', 'tpl1'));
    expect(buildPostApplicationRequestId('app1', 'tpl2')).not.toBe(buildPostApplicationRequestId('app1', 'tpl1'));
  });
});
