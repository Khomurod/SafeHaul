/**
 * PEV — a result reaches the driver's DQ file by itself: the portal answer's PDF
 * and a file uploaded with "Upload Result", one record per result, filed once.
 *
 * `employmentVerification.support.js` holds the harness. The result PDF's
 * builder is replaced here (`pevResultPdf.test.js` covers what it draws), so
 * the answer has a stored document to file.
 */

jest.mock('firebase-functions/v2/https', () => require('./employmentVerification.support').httpsV2Mock());
jest.mock('firebase-functions/v2/scheduler', () => require('./employmentVerification.support').schedulerMock());
jest.mock('firebase-functions', () => require('./employmentVerification.support').functionsMock());
jest.mock('../../emailService', () => require('./employmentVerification.support').emailServiceMock());
jest.mock('../../shared/rateLimiter', () => require('./employmentVerification.support').rateLimiterMock());
jest.mock('../../shared/companyAccess', () => require('./employmentVerification.support').companyAccessMock());
jest.mock('uuid', () => require('./employmentVerification.support').uuidMock());
jest.mock('pdf-lib', () => require('./employmentVerification.support').pdfLibMock());
jest.mock('../../firebaseAdmin', () => require('./employmentVerification.support').firebaseAdminMock());

const resultPathFor = (v, token) => `companies/${v.companyId}/${v.collectionName}/${v.applicationId}/pev_results/PEV_Old_Carrier_${token.slice(0, 8)}.pdf`;
const mockGenerateVerificationPDF = jest.fn(async (v, _response, token) => resultPathFor(v, token));
jest.mock('../../employmentVerification/pdf', () => ({
  generateVerificationPDF: (...args) => mockGenerateVerificationPDF(...args),
}));

const {
  appKey, applicationDocs, createTs, dqFileDocs, uploadedObjects, verificationDocs,
  mockSendDynamicEmail, failNextDqFiling, resetPevState,
} = require('./employmentVerification.support');

const { recordManualVerificationResult, submitVerificationResponse } = require('../../employmentVerification');
const { fileResultInDq } = require('../../employmentVerification/requestAttachment');

const TOKEN = 'portal-token-0123456789abcdef';
const APP = appKey('co-1', 'applications', 'app-1');
const RESULT_PATH = 'companies/co-1/applications/app-1/pev_results/PEV_Old_Carrier_portal-t.pdf';
const UPLOAD_PATH = 'companies/co-1/applications/app-1/pev_results/1700000000000_fax.pdf';

function seed() {
  verificationDocs.set(TOKEN, {
    token: TOKEN,
    requestId: 'req-1',
    status: 'opened',
    companyId: 'co-1',
    collectionName: 'applications',
    applicationId: 'app-1',
    employerIndex: 0,
    employerId: 'aaaaaaaaaaaa',
    employerName: 'Old Carrier',
    applicantName: 'Jane Driver',
    companyName: 'SafeHaul Carrier',
    createdAt: createTs(),
    expiresAt: createTs(Date.now() + 60000),
  });
  applicationDocs.set(APP, {
    employers: [{ companyName: 'Old Carrier', employerId: 'aaaaaaaaaaaa', verification: { status: 'Sent', history: [] } }],
  });
}

const answer = () => submitVerificationResponse({
  data: {
    token: TOKEN,
    response: {
      wasEmployed: true,
      respondentName: 'HR Lead',
      respondentTitle: 'HR Manager',
      respondentPhone: '555-222-3333',
      signatureData: 'TEXT_SIGNATURE:HR Lead',
      signatureMethod: 'typed',
    },
  },
  rawRequest: { ip: '127.0.0.1', headers: { 'user-agent': 'jest' } },
});

const dqRows = () => [...dqFileDocs].filter(([key]) => key.startsWith(`${APP}/`));
const carrierEmail = () => mockSendDynamicEmail.mock.calls.find(([, to]) => to === 'ops@safehaul.test')?.[3];

beforeEach(() => {
  resetPevState();
  mockGenerateVerificationPDF.mockImplementation(async (v, _response, token) => resultPathFor(v, token));
});

describe('a portal answer', () => {
  it('files its result PDF in the DQ file, once, and the carrier email says so', async () => {
    seed();

    await answer();

    const rows = dqRows();
    expect(rows).toHaveLength(1);
    const [[key, row]] = rows;
    expect(key).toMatch(/\/pev_result_[0-9a-f]{24}$/);
    expect(row).toMatchObject({
      type: 'pev_result',
      fileType: 'PEV Result – Old Carrier',
      label: 'PEV Result',
      fileName: 'Verification-of-Employment-Response-Jane-Driver.pdf',
      storagePath: RESULT_PATH,
      url: null,
      isSynced: true,
    });
    // The portal token answers as the employer; no team-readable record holds it.
    expect(JSON.stringify(rows)).not.toContain(TOKEN);
    expect(applicationDocs.get(APP).employers[0].verification).toMatchObject({ status: 'Completed', resultUrl: RESULT_PATH });
    expect(carrierEmail()).toContain("Full details and PDF have been automatically added to the applicant's DQ file.");
  });

  it('files nothing more when the answer is delivered again', async () => {
    seed();
    await answer();
    await expect(answer()).rejects.toMatchObject({ code: 'already-exists' });
    expect(dqRows()).toHaveLength(1);
  });

  it('does not claim a DQ filing when the PDF could not be made', async () => {
    seed();
    mockGenerateVerificationPDF.mockRejectedValue(new Error('pdf failed'));

    await answer();

    expect(dqRows()).toHaveLength(0);
    expect(applicationDocs.get(APP).employers[0].verification.status).toBe('Completed');
    expect(carrierEmail()).not.toContain('automatically added');
    expect(carrierEmail()).toContain('could not be added to the applicant');
  });

  it('does not claim a DQ filing when the filing failed', async () => {
    seed();
    failNextDqFiling();

    await answer();

    expect(dqRows()).toHaveLength(0);
    expect(carrierEmail()).not.toContain('automatically added');
  });
});

describe('filing a result', () => {
  const recordRef = () => require('../../firebaseAdmin').db
    .collection('companies').doc('co-1').collection('applications').doc('app-1');
  const filing = { path: RESULT_PATH, employerName: 'Old Carrier', fileName: 'r.pdf' };

  it('is idempotent: the same file is one record', async () => {
    await expect(fileResultInDq(recordRef(), filing)).resolves.toBe(true);
    await expect(fileResultInDq(recordRef(), filing)).resolves.toBe(true);
    expect(dqRows()).toHaveLength(1);
  });

  it('leaves a record the team removed removed', async () => {
    await fileResultInDq(recordRef(), filing);
    const [[key, row]] = dqRows();
    dqFileDocs.set(key, { ...row, removedAt: 'removed on the DQ tab' });

    await fileResultInDq(recordRef(), filing);

    expect(dqFileDocs.get(key).removedAt).toBe('removed on the DQ tab');
  });

  it('keeps two results of one employer apart', async () => {
    await fileResultInDq(recordRef(), filing);
    await fileResultInDq(recordRef(), { ...filing, path: UPLOAD_PATH });
    expect(dqRows()).toHaveLength(2);
  });
});

describe('Upload Result', () => {
  const upload = () => recordManualVerificationResult({
    auth: { uid: 'recruiter-1' },
    data: {
      companyId: 'co-1', applicationId: 'app-1', collectionName: 'applications',
      employerId: 'aaaaaaaaaaaa', employerIndex: 0, employerName: 'Old Carrier',
      storagePath: UPLOAD_PATH, fileName: 'fax.pdf',
    },
  });

  it('files the uploaded file in the DQ file the same way, once', async () => {
    seed();
    uploadedObjects.add(UPLOAD_PATH);

    const result = await upload();
    await upload();

    expect(result.filedInDq).toBe(true);
    const rows = dqRows();
    expect(rows).toHaveLength(1);
    expect(rows[0][1]).toMatchObject({
      type: 'pev_result',
      fileType: 'PEV Result – Old Carrier',
      fileName: 'fax.pdf',
      storagePath: UPLOAD_PATH,
      url: null,
      isSynced: true,
      uploadedBy: 'recruiter-1',
    });
  });

  it('says when the DQ file could not take it, and still records the result', async () => {
    seed();
    uploadedObjects.add(UPLOAD_PATH);
    failNextDqFiling();

    const result = await upload();

    expect(result).toMatchObject({ success: true, filedInDq: false });
    expect(applicationDocs.get(APP).employers[0].verification.status).toBe('Completed');
  });
});
