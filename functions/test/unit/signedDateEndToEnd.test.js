/**
 * The whole point of the Date Signed fix, proved end to end: a document prepared
 * on one day and signed on a later one must carry the LATER date, both in the
 * stored record and in the sealed PDF a company downloads.
 *
 * Both halves run for real here — `submitPublicEnvelope` writes the record and
 * `sealDocument` draws it into the PDF — because the bug lived in the seam
 * between them. Everything is synthetic: no production document or person.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { PDFDocument, StandardFonts } = require('pdf-lib');

let sealHandler;

jest.mock('firebase-functions/v2/https', () => ({
  onCall: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
  HttpsError: class HttpsError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  },
}));

jest.mock('firebase-functions/v1', () => ({
  runWith: () => ({
    firestore: {
      document: () => ({
        onUpdate: (handler) => {
          sealHandler = handler;
          return handler;
        },
      }),
    },
  }),
}));

const mockRequestUpdate = jest.fn().mockResolvedValue(undefined);
const mockUpload = jest.fn();
const mockDownload = jest.fn();

jest.mock('../../firebaseAdmin', () => {
  const requestDocRef = {
    update: (...args) => mockRequestUpdate(...args),
    collection: jest.fn(() => ({ doc: jest.fn(() => ({ delete: jest.fn().mockResolvedValue(undefined) })) })),
  };
  return {
    admin: { firestore: { FieldValue: { serverTimestamp: jest.fn(() => ({ __ts: true })) } } },
    db: {
      runTransaction: (...args) => global.__mockRunTransaction(...args),
      collection: jest.fn(() => ({
        add: jest.fn().mockResolvedValue(undefined),
        doc: jest.fn(() => ({ collection: jest.fn(() => ({ doc: jest.fn(() => requestDocRef) })) })),
      })),
    },
    storage: {
      bucket: jest.fn(() => ({
        name: 'test-bucket',
        file: jest.fn(() => ({
          save: jest.fn().mockResolvedValue(undefined),
          download: (...args) => mockDownload(...args),
          delete: jest.fn().mockResolvedValue(undefined),
        })),
        upload: (...args) => mockUpload(...args),
      })),
    },
  };
});

jest.mock('../../shared/rateLimiter', () => ({ checkRateLimit: jest.fn().mockResolvedValue(true) }));

const { submitPublicEnvelope } = require('../../publicSigning');
require('../../digitalSealing');

/**
 * The visible text of a pdf-lib document. Content streams are Flate-compressed
 * and the glyphs are written as hex-encoded `Tj` operands, so reading the bytes
 * back is the only way to assert what a person would actually SEE on the page.
 */
function drawnTextOf(pdfBuffer) {
  const latin = pdfBuffer.toString('latin1');
  let body = '';
  let cursor = 0;
  for (;;) {
    const start = latin.indexOf('stream', cursor);
    if (start < 0) break;
    let from = start + 'stream'.length;
    if (latin[from] === '\r') from += 1;
    if (latin[from] === '\n') from += 1;
    const end = latin.indexOf('endstream', from);
    if (end < 0) break;
    const chunk = Buffer.from(latin.slice(from, end), 'latin1');
    try {
      body += zlib.inflateSync(chunk).toString('latin1');
    } catch {
      body += chunk.toString('latin1');
    }
    cursor = end + 'endstream'.length;
  }
  // Joined and whitespace-normalized because pdf-lib splits a line that reaches
  // `maxWidth` into separate operands — "September 11," and "2026" are one date
  // on the page and must read as one string here.
  return Array.from(body.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g))
    .map((match) => Buffer.from(match[1], 'hex').toString('utf8'))
    .join(' ')
    .replace(/\s+/g, ' ');
}

// The document is prepared in May and signed in September. No formatting
// accident could turn one of these into the other.
const SIGNED_ON = new Date('2026-09-11T12:00:00Z');
const PREPARED_LABEL = 'May 7, 2026';

// Exactly what the send path now stores: the signing date deferred, every other
// value already resolved, and an ordinary date left alone.
const SENT_FIELDS = [
  {
    id: 'date_signed',
    type: 'date',
    label: 'Date Signed',
    required: true,
    readOnly: true,
    prefillPolicy: 'locked',
    bindingKey: 'current_date',
    defaultValue: '{{current_date}}',
    pageNumber: 1,
    x: 10,
    y: 30,
    width: 40,
    height: 5,
  },
  {
    id: 'dob',
    type: 'text',
    label: 'Date of Birth',
    required: true,
    bindingKey: 'dob',
    defaultValue: 'January 2, 1980',
    pageNumber: 1,
    x: 10,
    y: 45,
    width: 40,
    height: 5,
  },
];

async function writeBlankPdf(destination) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  page.drawText('Synthetic template', { x: 50, y: 740, size: 12, font });
  fs.writeFileSync(destination, await pdfDoc.save());
}

describe('a document prepared in May and signed in September', () => {
  let templatePdf;

  beforeAll(async () => {
    templatePdf = path.join(os.tmpdir(), `signed-date-e2e-${Date.now()}.pdf`);
    await writeBlankPdf(templatePdf);
  });

  afterAll(() => {
    if (fs.existsSync(templatePdf)) fs.unlinkSync(templatePdf);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockRequestUpdate.mockResolvedValue(undefined);
    mockDownload.mockImplementation(async ({ destination }) => {
      fs.copyFileSync(templatePdf, destination);
    });
    global.__mockRunTransaction = async (cb) => {
      let call = 0;
      return cb({
        get: jest.fn(async () => {
          call += 1;
          if (call === 1) {
            return {
              exists: true,
              data: () => ({
                status: 'sent',
                expiresAt: { toMillis: () => SIGNED_ON.getTime() + 86400000 },
                fields: SENT_FIELDS,
              }),
            };
          }
          return { exists: true, data: () => ({ accessToken: 'synthetic-token' }) };
        }),
        update: jest.fn(),
      });
    };
  });

  it('stores and seals the September date, and leaves the date of birth alone', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick'] }).setSystemTime(SIGNED_ON);
    let sealedPdf = null;
    mockUpload.mockImplementation(async (localPath) => {
      // Read it here: the sealer deletes the file in its `finally` block.
      sealedPdf = fs.readFileSync(localPath);
    });

    try {
      const submitted = await submitPublicEnvelope({
        data: {
          companyId: 'co1',
          requestId: 'req1',
          accessToken: 'synthetic-token',
          // What the browser had on screen. The server decides regardless.
          fieldValues: { date_signed: 'September 11, 2026', dob: 'January 2, 1980' },
          auditData: { userAgent: 'jest' },
        },
        rawRequest: { headers: {}, ip: '203.0.113.10' },
      });
      expect(submitted.success).toBe(true);

      const stored = mockRequestUpdate.mock.calls[0][0];
      expect(stored.status).toBe('pending_seal');
      expect(stored.fieldValues.date_signed).toBe('September 11, 2026');
      expect(stored.fieldValues.dob).toBe('January 2, 1980');
      expect(stored.fields.find((f) => f.id === 'date_signed').defaultValue).toBe('September 11, 2026');

      // Seal exactly what submission stored — the seam where the stale date used
      // to survive.
      await sealHandler(
        {
          before: { data: () => ({ status: 'sent' }) },
          after: {
            data: () => ({
              status: 'pending_seal',
              title: 'Synthetic Agreement',
              recipientName: 'Artificial Person',
              storagePath: 'secure_documents/co1/templates/synthetic.pdf',
              fields: stored.fields,
              fieldValues: stored.fieldValues,
              auditTrail: { ip: '203.0.113.10', userAgent: 'jest' },
            }),
            ref: { update: mockRequestUpdate },
          },
        },
        { params: { companyId: 'co1', requestId: 'req1' } },
      );
    } finally {
      jest.useRealTimers();
    }

    expect(sealedPdf).not.toBeNull();
    const visible = drawnTextOf(sealedPdf);
    expect(visible).toContain('September 11, 2026');
    expect(visible).not.toContain(PREPARED_LABEL);
    expect(visible).not.toContain('{{current_date}}');
    // The requirement's other half: an ordinary date is printed as it was.
    expect(visible).toContain('January 2, 1980');
  });
});
