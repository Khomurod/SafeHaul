const fs = require('fs');
const os = require('os');
const path = require('path');
const { PDFDocument, StandardFonts } = require('pdf-lib');

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
