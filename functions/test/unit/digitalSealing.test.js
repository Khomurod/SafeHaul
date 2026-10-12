const fs = require('fs');
const os = require('os');
const path = require('path');
const { PDFDocument, PDFPage, StandardFonts } = require('pdf-lib');

let sealHandler;

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

const mockUpdate = jest.fn().mockResolvedValue(undefined);
const mockUpload = jest.fn().mockResolvedValue(undefined);
const mockDownload = jest.fn();
const mockFileDelete = jest.fn().mockResolvedValue(undefined);

jest.mock('../../firebaseAdmin', () => ({
  admin: {
    firestore: {
      FieldValue: {
        serverTimestamp: jest.fn(() => ({ __ts: true })),
      },
    },
  },
  db: {
    collection: jest.fn(() => ({
      add: jest.fn().mockResolvedValue(undefined),
    })),
  },
  storage: {
    bucket: jest.fn(() => ({
      name: 'test-bucket',
      file: jest.fn(() => ({
        download: mockDownload,
        delete: mockFileDelete,
      })),
      upload: mockUpload,
    })),
  },
}));

require('../../digitalSealing');

async function createMinimalPdf(destPath) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  page.drawText('Seal test', { x: 50, y: 700, size: 12, font });
  const bytes = await pdfDoc.save();
  fs.writeFileSync(destPath, bytes);
}

describe('sealDocument trigger', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdate.mockResolvedValue(undefined);
  });

  it('seals a document with text field values and marks request signed', async () => {
    const tempPdf = path.join(os.tmpdir(), `seal-test-${Date.now()}.pdf`);
    await createMinimalPdf(tempPdf);

    mockDownload.mockImplementation(async ({ destination }) => {
      fs.copyFileSync(tempPdf, destination);
    });

    const change = {
      before: { data: () => ({ status: 'sent' }) },
      after: {
        data: () => ({
          status: 'pending_seal',
          title: 'Offer Letter',
          recipientName: 'Jane Doe',
          storagePath: 'secure_documents/co1/templates/offer.pdf',
          fields: [
            {
              id: 'name',
              type: 'text',
              pageNumber: 1,
              x: 10,
              y: 80,
              width: 30,
              height: 5,
              required: true,
            },
          ],
          fieldValues: { name: 'Jane Doe' },
        }),
        ref: { update: mockUpdate },
      },
    };

    const context = { params: { companyId: 'co1', requestId: 'req-seal-1' } };

    await sealHandler(change, context);

    expect(mockDownload).toHaveBeenCalled();
    expect(mockUpload).toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'signed',
        signedPdfUrl: 'secure_documents/co1/completed/req-seal-1_signed.pdf',
        sha256Checksum: expect.any(String),
      }),
    );

    fs.unlinkSync(tempPdf);
  });

  it('skips when status is not transitioning to pending_seal', async () => {
    const change = {
      before: { data: () => ({ status: 'sent' }) },
      after: {
        data: () => ({ status: 'sent' }),
        ref: { update: mockUpdate },
      },
    };
    await sealHandler(change, { params: { companyId: 'co1', requestId: 'req2' } });
    expect(mockDownload).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

// The seal draws in a standard font, which encodes WinAnsi only: pdf-lib throws
// on any other character. A signer named outside Latin script, or an answer
// typed in one, left the envelope at 'error_sealing' for good.
describe('sealDocument with text a standard font cannot encode', () => {
  const drawn = [];
  const originalDrawText = PDFPage.prototype.drawText;
  let drawTextSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdate.mockResolvedValue(undefined);
    drawn.length = 0;
    drawTextSpy = jest.spyOn(PDFPage.prototype, 'drawText').mockImplementation(function record(text, options) {
      drawn.push(text);
      return originalDrawText.call(this, text, options);
    });
  });

  afterEach(() => drawTextSpy.mockRestore());

  async function seal(data, requestId) {
    const tempPdf = path.join(os.tmpdir(), `seal-test-${requestId}.pdf`);
    await createMinimalPdf(tempPdf);
    mockDownload.mockImplementation(async ({ destination }) => {
      fs.copyFileSync(tempPdf, destination);
    });
    try {
      await sealHandler({
        before: { data: () => ({ status: 'sent' }) },
        after: {
          data: () => ({
            status: 'pending_seal',
            storagePath: 'secure_documents/co1/templates/offer.pdf',
            ...data,
          }),
          ref: { update: mockUpdate },
        },
      }, { params: { companyId: 'co1', requestId } });
    } finally {
      fs.unlinkSync(tempPdf);
    }
  }

  const field = (id, type) => ({ id, type, pageNumber: 1, x: 10, y: 60, width: 40, height: 5, required: true });

  it('seals a document signed by a name outside Latin script, the letters drawn as "?"', async () => {
    await seal({
      title: 'Договор 🚚',
      recipientName: 'Иван Петров',
      recipientEmail: 'ivan@example.test',
      auditTrail: { ip: '203.0.113.7', userAgent: 'Mozilla/5.0' },
      fields: [field('name', 'text'), field('signedOn', 'date')],
      fieldValues: { name: '王小明', signedOn: '10/12/2026' },
    }, 'req-seal-unicode');

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'signed' }));
    expect(mockUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'error_sealing' }));
    expect(drawn).toContain('???');
    expect(drawn).toContain('10/12/2026');
    const audit = drawn.find((text) => text.includes('SIGNER NAME'));
    expect(audit).toMatch(/DOCUMENT TITLE: \?{7} \?+\n/);
    expect(audit).toContain('SIGNER NAME: ???? ??????');
    expect(audit).toContain('SIGNER EMAIL: ivan@example.test');
  });

  it('keeps the lines of an answer typed on several lines, and drops what cannot be drawn', async () => {
    await seal({
      title: 'Offer Letter',
      recipientName: 'Jane Doe',
      fields: [field('notes', 'text')],
      fieldValues: { notes: 'Line one\r\nLine two\u0007' },
    }, 'req-seal-lines');

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'signed' }));
    expect(drawn).toContain('Line one\nLine two');
  });
});
