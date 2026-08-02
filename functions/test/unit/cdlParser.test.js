jest.mock('firebase-functions/v1', () => {
  class HttpsError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }
  const https = { HttpsError, onCall: (fn) => fn };
  return { https, runWith: () => ({ https }) };
});

jest.mock('../../firebaseAdmin', () => ({ db: {} }));
jest.mock('../../shared/companyTenant', () => ({
  assertCompanyAcceptingIntake: jest.fn().mockResolvedValue({ companyName: 'Tenant Co' }),
}));
jest.mock('../../shared/rateLimiter', () => ({
  checkRateLimit: jest.fn().mockResolvedValue(true),
}));

const { parseCdlWithGroq, __private } = require('../../cdlParser');
const { checkRateLimit } = require('../../shared/rateLimiter');
const { assertCompanyAcceptingIntake } = require('../../shared/companyTenant');

describe('parseCdlWithGroq', () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.GROQ_API_KEY;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GROQ_API_KEY = 'test-groq-key';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  firstName: 'John',
                  lastName: 'Doe',
                  dateOfBirth: '01/01/1990',
                  fullAddress: '123 Main St, Dallas, TX 75001',
                  cdlNumber: 'D1234567',
                  expirationDate: '12/31/2030',
                }),
              },
            ],
          },
        ],
      }),
    });
  });

  afterAll(() => {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalApiKey;
  });

  it('allows unauthenticated guest caller and returns normalized fields', async () => {
    const data = {
      companyId: 'co1',
      imageDataUrl: 'data:image/jpeg;base64,AAAA',
      storagePath: 'companies/co1/autofill/guest_uploads/x.jpg',
    };
    const context = { rawRequest: { ip: '203.0.113.8' }, auth: undefined };

    const res = await parseCdlWithGroq(data, context);

    expect(res.success).toBe(true);
    expect(res.fields.firstName).toBe('John');
    expect(res.fields.cdlNumber).toBe('D1234567');
    expect(checkRateLimit).toHaveBeenCalled();
    expect(assertCompanyAcceptingIntake).toHaveBeenCalledWith(expect.anything(), 'co1');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.groq.com/openai/v1/responses',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('rejects missing api key', async () => {
    delete process.env.GROQ_API_KEY;
    await expect(parseCdlWithGroq(
      { companyId: 'co1', imageDataUrl: 'data:image/png;base64,AAAA' },
      { rawRequest: { ip: '203.0.113.9' } }
    )).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('rejects non-image payloads', async () => {
    await expect(parseCdlWithGroq(
      { companyId: 'co1', imageDataUrl: 'data:application/pdf;base64,AAAA' },
      { rawRequest: { ip: '203.0.113.10' } }
    )).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('extractJsonObject handles wrapped text', () => {
    const parsed = __private.extractJsonObject('hello {"firstName":"A","lastName":"B","dateOfBirth":"","fullAddress":"","cdlNumber":"","expirationDate":""} world');
    expect(parsed.firstName).toBe('A');
  });
});

