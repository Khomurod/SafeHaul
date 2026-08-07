// Wiring test: submitting an application must freeze a submission snapshot, and
// a snapshot failure must never lose an application the driver already sent.
jest.mock('firebase-functions/v1', () => {
  class HttpsError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }
  const https = { HttpsError, onCall: (fn) => fn };
  return { https, runWith: () => ({ https }) };
});

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => ({ __srv: true }) },
}));

// In-memory Firestore covering the full path the writer walks:
// companies/{id}/applications/{id}/submission/{seq}
const mockState = {
  applications: {},   // path -> data
  snapshots: {},      // path -> data
  dqFiles: {},        // path -> data
  storedPdfs: {},     // storage path -> { buffer, options }
  publicProfile: null,
  createShouldFail: null,
  attempts: {},
  txLock: null,
};

function mockApplicationDoc(companyId, applicationId) {
  const appPath = `companies/${companyId}/applications/${applicationId}`;
  return {
    async set(data) { mockState.applications[appPath] = { ...(mockState.applications[appPath] || {}), ...data }; },
    async get() {
      return appPath in mockState.applications
        ? { exists: true, data: () => mockState.applications[appPath] }
        : { exists: false, data: () => null };
    },
    collection: (name) => ({
      // Equality query over the subcollection, as used by the idempotency check.
      where: (field, op, value) => ({
        limit: (n) => ({
          async get() {
            const prefix = `${appPath}/${name}/`;
            const matches = Object.entries(mockState.snapshots)
              .filter(([path, data]) => path.startsWith(prefix) && op === '==' && data[field] === value)
              .slice(0, n)
              .map(([path, data]) => ({ id: path.split('/').pop(), data: () => data }));
            return { empty: matches.length === 0, docs: matches };
          },
        }),
      }),
      doc: (seq) => {
        const path = `${appPath}/${name}/${seq}`;
        if (name === 'submission_attempts') {
          return {
            path,
            async create(data) {
              if (path in mockState.attempts) {
                const err = new Error('6 ALREADY_EXISTS'); err.code = 6; throw err;
              }
              mockState.attempts[path] = data;
            },
            async get() {
              return path in mockState.attempts
                ? { exists: true, data: () => mockState.attempts[path] }
                : { exists: false, data: () => undefined };
            },
          };
        }
        if (name === 'dq_files') {
          return {
            async set(data, options) {
              const base = options && options.merge ? (mockState.dqFiles[path] || {}) : {};
              mockState.dqFiles[path] = { ...base, ...data };
            },
          };
        }
        return {
          path,
          async create(data) {
            if (mockState.createShouldFail) throw mockState.createShouldFail;
            if (path in mockState.snapshots) {
              const err = new Error('6 ALREADY_EXISTS'); err.code = 6; throw err;
            }
            mockState.snapshots[path] = data;
          },
          async get() {
            return path in mockState.snapshots
              ? { exists: true, data: () => mockState.snapshots[path] }
              : { exists: false, data: () => undefined };
          },
        };
      },
    }),
  };
}

jest.mock('../../firebaseAdmin', () => ({
  admin: { firestore: { FieldValue: { serverTimestamp: () => ({ __srv: true }) } } },
  storage: {
    bucket: () => ({
      file: (path) => ({
        exists: async () => [path in mockState.storedPdfs],
        getMetadata: async () => [mockState.storedPdfs[path]?.options?.metadata || {}],
        save: async (buffer, options) => {
          if (options?.preconditionOpts?.ifGenerationMatch === 0 && path in mockState.storedPdfs) {
            const error = new Error('precondition failed'); error.code = 412; throw error;
          }
          mockState.storedPdfs[path] = { buffer, options };
        },
      }),
    }),
  },
  db: {
    // Serialised like Firestore's: the whole callback runs to completion before
    // another transaction starts, and its writes land atomically at the end.
    // That is what makes the attempt claim safe against a concurrent redelivery.
    runTransaction: async (fn) => {
      while (mockState.txLock) await mockState.txLock;
      let release;
      mockState.txLock = new Promise((resolve) => { release = resolve; });
      try {
        const writes = [];
        const tx = {
          get: (ref) => ref.get(),
          create: (ref, data) => { writes.push([ref, data]); },
        };
        const result = await fn(tx);
        for (const [ref, data] of writes) await ref.create(data);
        return result;
      } finally {
        mockState.txLock = null;
        release();
      }
    },
    collection: (col) => {
      if (col === 'public_profiles') {
        return { doc: () => ({ get: async () => (mockState.publicProfile
          ? { exists: true, data: () => mockState.publicProfile }
          : { exists: false }) }) };
      }
      if (col === 'companies') {
        return { doc: (companyId) => ({
          collection: () => ({ doc: (applicationId) => mockApplicationDoc(companyId, applicationId) }),
        }) };
      }
      return { doc: () => ({}) };
    },
  },
}));

jest.mock('../../shared/companyTenant', () => ({
  assertCompanyAcceptingIntake: jest.fn().mockResolvedValue({
    companyName: 'Artificial Freight Co',
    dotNumber: '1234567',
    address: { street: '1 Test Way', city: 'Springfield', state: 'IL', zip: '62701' },
    contact: { email: 'hr@example.test', phone: '555-0100' },
    applicationConfig: {
      cdlUpload: { hidden: false, required: false },
      medCardUpload: { hidden: false, required: false },
    },
    customQuestions: [{ id: 'q-company', label: 'Company-doc question' }],
  }),
}));

jest.mock('../../shared/rateLimiter', () => ({ checkRateLimit: jest.fn().mockResolvedValue(true) }));

const { submitGuestApplication } = require('../../guestApplication');

const payload = (formData = {}) => ({
  companyId: 'co1',
  email: 'ann@example.test',
  phone: '5551234567',
  signature: 'data:image/png;base64,AAA',
  formData: { firstName: 'Ann', lastName: 'Adams', ...formData },
});
const ctx = { rawRequest: { ip: '203.0.113.1' } };

// The public profile REPLACES the company config, so a fixture that omits the
// upload gates would make CDL uploads required by default (correct behaviour,
// but not what these cases are exercising).
const NO_REQUIRED_UPLOADS = {
  cdlUpload: { hidden: false, required: false },
  medCardUpload: { hidden: false, required: false },
};

const storedSnapshots = () => Object.entries(mockState.snapshots);
const onlySnapshot = () => storedSnapshots()[0][1];

beforeEach(() => {
  jest.clearAllMocks();
  mockState.applications = {};
  mockState.snapshots = {};
  mockState.dqFiles = {};
  mockState.storedPdfs = {};
  mockState.publicProfile = null;
  mockState.createShouldFail = null;
  mockState.attempts = {};
  mockState.txLock = null;
});

describe('submission freezes a snapshot', () => {
  it('writes the original snapshot as v1 and reports its id', async () => {
    const res = await submitGuestApplication(payload(), ctx);
    expect(res.success).toBe(true);
    expect(res.snapshotId).toBe('v1');
    expect(storedSnapshots()).toHaveLength(1);
    expect(storedSnapshots()[0][0]).toMatch(/\/submission\/v1$/);
  });

  it('stores it under the FINAL application id', async () => {
    const res = await submitGuestApplication(payload(), ctx);
    expect(storedSnapshots()[0][0]).toContain(`/applications/${res.applicationId}/`);
  });

  it('freezes the frozen marker, versions and company identity', async () => {
    await submitGuestApplication(payload(), ctx);
    const snap = onlySnapshot();
    expect(snap.frozen).toBe(true);
    expect(snap.definitionVersion).toMatch(/^[a-f0-9]{16}$/);
    expect(snap.agreementVersion).toBe('v1');
    // Company identity comes from the company document — the public profile
    // deliberately does not expose an address or DOT number.
    expect(snap.company.companyName).toBe('Artificial Freight Co');
    expect(snap.company.dotNumber).toBe('1234567');
    expect(snap.company.address.city).toBe('Springfield');
  });

  it('records the driver answers with real labels', async () => {
    await submitGuestApplication(payload(), ctx);
    const answers = onlySnapshot().sections.flatMap((s) => s.answers);
    const first = answers.find((a) => a.fieldId === 'firstName');
    expect(first.label).toBe('First Name');
    expect(first.displayValue).toBe('Ann');
  });

  it('captures all four agreements including the Clearinghouse consent', async () => {
    await submitGuestApplication(payload(), ctx);
    const ids = onlySnapshot().agreements.map((a) => a.id);
    expect(ids).toEqual(['electronicSignature', 'fcraDisclosure', 'pspDisclosure', 'clearinghouseConsent']);
  });

  it('attaches no signature to an agreement with no acceptance evidence', async () => {
    await submitGuestApplication(payload(), ctx);
    // This payload sends no agreementAcceptances at all.
    for (const agreement of onlySnapshot().agreements) {
      expect(agreement.accepted).toBe(false);
      expect(agreement.signature).toBeNull();
      // The wording presented is still recorded.
      expect(agreement.body).toContain('Artificial Freight Co');
    }
  });

  it('records per-agreement acceptance when the client supplies it', async () => {
    await submitGuestApplication(payload({
      agreementAcceptances: {
        electronicSignature: { accepted: true, acceptedAt: '2026-06-15T12:00:00.000Z' },
        fcraDisclosure: { accepted: true, acceptedAt: '2026-06-15T12:00:01.000Z' },
        pspDisclosure: { accepted: true, acceptedAt: '2026-06-15T12:00:02.000Z' },
        clearinghouseConsent: { accepted: true, acceptedAt: '2026-06-15T12:00:03.000Z' },
      },
    }), ctx);

    const agreements = onlySnapshot().agreements;
    expect(agreements.every((a) => a.accepted === true)).toBe(true);
    expect(agreements.every((a) => a.signature !== null)).toBe(true);
    expect(agreements[0].acceptedAt).toBe('2026-06-15T12:00:00.000Z');
  });

  it('records the IP the server observed, not one the client claims', async () => {
    // Acceptance evidence that the accepting party can forge is not evidence.
    await submitGuestApplication(payload({
      agreementAcceptances: {
        electronicSignature: {
          accepted: true,
          acceptedAt: '2026-06-15T12:00:00.000Z',
          ip: '10.0.0.1',                    // forged by the client
          userAgent: 'Mozilla/5.0 (Test)',   // legitimately self-reported
        },
      },
    }), ctx);

    const accepted = onlySnapshot().agreements.find((a) => a.id === 'electronicSignature');
    expect(accepted.acceptanceContext.ip).toBe('203.0.113.1');
    expect(accepted.acceptanceContext.ip).not.toBe('10.0.0.1');
    expect(accepted.acceptanceContext.userAgent).toBe('Mozilla/5.0 (Test)');
  });

  it('stamping does not resurrect acceptance the driver never gave', async () => {
    await submitGuestApplication(payload({
      agreementAcceptances: {
        electronicSignature: { accepted: false, ip: '10.0.0.1' },
      },
    }), ctx);

    const agreements = onlySnapshot().agreements;
    expect(agreements.every((a) => a.accepted === false)).toBe(true);
    expect(agreements.every((a) => a.signature === null)).toBe(true);
  });

  it('stamps owner ids so the driver can read their own snapshot', async () => {
    const res = await submitGuestApplication(payload(), ctx);
    const snap = onlySnapshot();
    expect(snap.applicantId).toBe(res.applicationId);
    expect(snap.driverId).toBe(res.applicationId);
    expect(snap.companyId).toBe('co1');
  });

  it('records employment coverage as computed at submission', async () => {
    await submitGuestApplication(payload({
      employers: [{ startDate: '2020-01', endDate: 'Present', companyName: 'Prior Carrier' }],
    }), ctx);
    expect(onlySnapshot().employmentCoverage.isComplete).toBe(true);
  });

  it('marks the record as a live submission, not a reconstruction', async () => {
    await submitGuestApplication(payload(), ctx);
    expect(onlySnapshot().provenance).toEqual({ source: 'submission', notes: [] });
  });
});

describe('questions are captured as the driver saw them', () => {
  it('prefers the public profile questions, which is what the apply page renders', async () => {
    mockState.publicProfile = {
      companyName: 'Artificial Freight Co',
      applicationConfig: NO_REQUIRED_UPLOADS,
      customQuestions: [{ id: 'q-public', label: 'Public-profile question' }],
    };
    await submitGuestApplication(payload({ customAnswers: { 'q-public': 'Answered' } }), ctx);

    const custom = onlySnapshot().customAnswers;
    expect(custom.map((q) => q.questionId)).toEqual(['q-public']);
    expect(custom[0].label).toBe('Public-profile question');
    expect(custom[0].displayValue).toBe('Answered');
  });

  it('falls back to the company document when there is no public profile', async () => {
    await submitGuestApplication(payload({ customAnswers: { 'q-company': 'Yes' } }), ctx);
    expect(onlySnapshot().customAnswers[0].label).toBe('Company-doc question');
  });

  it('keeps an answer whose question is unknown, without using the id as wording', async () => {
    mockState.publicProfile = { companyName: 'Artificial Freight Co', applicationConfig: NO_REQUIRED_UPLOADS, customQuestions: [] };
    await submitGuestApplication(payload({ customAnswers: { 'deleted-uuid': 'Some answer' } }), ctx);

    const orphan = onlySnapshot().customAnswers.find((a) => a.questionId === 'deleted-uuid');
    expect(orphan.unknownQuestion).toBe(true);
    expect(orphan.label).toBeNull();
    expect(orphan.displayValue).toBe('Some answer');
  });
});

describe('a snapshot failure must not lose the application', () => {
  it('still succeeds, and reports no snapshot id, when the snapshot write fails', async () => {
    const err = new Error('7 PERMISSION_DENIED'); err.code = 7;
    mockState.createShouldFail = err;
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await submitGuestApplication(payload(), ctx);

    // The application the driver submitted is saved either way.
    expect(res.success).toBe(true);
    expect(res.applicationId).toMatch(/^[a-z0-9]{20}$/);
    expect(res.snapshotId).toBeNull();
    expect(Object.keys(mockState.applications)).toHaveLength(1);
    // And the failure is logged loudly for the reconstruction job to pick up.
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('Submission snapshot failed'),
      expect.anything(),
    );
    consoleError.mockRestore();
  });

  it('re-submission adds a sibling snapshot rather than overwriting the original', async () => {
    const first = await submitGuestApplication(payload({ firstName: 'Ann' }), ctx);
    const second = await submitGuestApplication(payload({ firstName: 'Ann' }), ctx);

    // Same applicant key -> same application, two submission records.
    expect(second.applicationId).toBe(first.applicationId);
    expect(first.snapshotId).toBe('v1');
    expect(second.snapshotId).toBe('v2');
    expect(storedSnapshots()).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Redelivery.
//
// The applicant's browser retries three times with backoff, and the offline
// queue replays the identical payload when connectivity returns. Both can
// deliver ONE submission more than once. Neither may turn it into two preserved
// records — that would invent a resubmission the driver never made and put a
// second document in the record claiming to be the original.
// ---------------------------------------------------------------------------
describe('one submission stays one preserved record', () => {
  it('a redelivered attempt reuses the record it already wrote', async () => {
    const attempt = { submissionAttemptId: 'sub_fixed_attempt_id' };

    const first = await submitGuestApplication(payload(attempt), ctx);
    const second = await submitGuestApplication(payload(attempt), ctx);

    expect(first.snapshotId).toBe('v1');
    expect(second.snapshotId).toBe('v1');
    expect(storedSnapshots()).toHaveLength(1);
  });

  it('all three browser retries of one Submit collapse to one record', async () => {
    const attempt = { submissionAttemptId: 'sub_retry_loop' };
    await submitGuestApplication(payload(attempt), ctx);
    await submitGuestApplication(payload(attempt), ctx);
    await submitGuestApplication(payload(attempt), ctx);
    expect(storedSnapshots()).toHaveLength(1);
  });

  it('an offline replay of an already-recorded submission adds nothing', async () => {
    const attempt = { submissionAttemptId: 'sub_offline' };
    await submitGuestApplication(payload(attempt), ctx);

    // What useSubmissionQueue sends on replay: the same payload, plus the
    // queue's own lifecycle markers.
    await submitGuestApplication(payload({
      ...attempt,
      lifecycle: { processedFromQueue: true, queueProcessedAt: '2026-06-15T12:00:00.000Z' },
    }), ctx);

    expect(storedSnapshots()).toHaveLength(1);
  });

  it('a genuine resubmission still takes the next sequence', async () => {
    await submitGuestApplication(payload({ submissionAttemptId: 'sub_one' }), ctx);
    const again = await submitGuestApplication(payload({ submissionAttemptId: 'sub_two' }), ctx);

    expect(again.snapshotId).toBe('v2');
    expect(storedSnapshots()).toHaveLength(2);
  });

  it('records the attempt id on the snapshot so redelivery is recognisable', async () => {
    await submitGuestApplication(payload({ submissionAttemptId: 'sub_stamped' }), ctx);
    expect(onlySnapshot().submissionAttemptId).toBe('sub_stamped');
  });

  it('treats a submission with no attempt id as its own, exactly as before', async () => {
    await submitGuestApplication(payload(), ctx);
    await submitGuestApplication(payload(), ctx);
    expect(storedSnapshots()).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Findability.
//
// The snapshot write is best-effort on purpose — an applicant must not lose a
// submitted application because a subcollection write failed. But a failure that
// only reaches the log cannot be enumerated, so nothing could ever find the
// affected applications again.
// ---------------------------------------------------------------------------
describe('every submission states whether it was preserved', () => {
  const applicationDoc = () => Object.values(mockState.applications)[0];

  it('marks a preserved application as recorded, with its versions', async () => {
    await submitGuestApplication(payload({ submissionAttemptId: 'sub_ok' }), ctx);
    const record = applicationDoc().submissionRecord;

    expect(record.status).toBe('recorded');
    expect(record.snapshotId).toBe('v1');
    expect(record.sequence).toBe(1);
    expect(record.isOriginal).toBe(true);
    expect(record.definitionVersion).toMatch(/^[a-f0-9]{16}$/);
    expect(record.agreementVersion).toBe('v1');
    expect(record.submissionAttemptId).toBe('sub_ok');
    expect(record.recordedAt).toEqual(expect.any(String));
  });

  it('marks a failed snapshot as failed, with the reason and the attempt', async () => {
    mockState.createShouldFail = new Error('Firestore unavailable');

    const res = await submitGuestApplication(payload({ submissionAttemptId: 'sub_fail' }), ctx);

    // The application itself still succeeded. That is the whole point.
    expect(res.success).toBe(true);
    expect(res.snapshotId).toBeNull();

    const record = applicationDoc().submissionRecord;
    expect(record.status).toBe('failed');
    expect(record.error).toContain('Firestore unavailable');
    expect(record.submissionAttemptId).toBe('sub_fail');
    expect(record.failedAt).toEqual(expect.any(String));
  });

  it('reports a redelivery as deduplicated rather than as a fresh write', async () => {
    const attempt = { submissionAttemptId: 'sub_dedup' };
    await submitGuestApplication(payload(attempt), ctx);
    await submitGuestApplication(payload(attempt), ctx);
    expect(applicationDoc().submissionRecord.deduplicated).toBe(true);
  });
});


// ---------------------------------------------------------------------------
// The preserved PDF must describe the record that was actually STORED.
// ---------------------------------------------------------------------------

describe('preserving the application PDF at submission', () => {
  const submit = (formData = {}) => submitGuestApplication(payload(formData), { rawRequest: { ip: '203.0.113.9' } });
  const applicationDoc = () => Object.values(mockState.applications)[0];

  it('stores an original alongside the snapshot, and files it as a DQ document', async () => {
    await submit();

    const paths = Object.keys(mockState.storedPdfs);
    expect(paths).toHaveLength(1);
    expect(paths[0]).toMatch(/^application_originals\/co1\/.+\/v1\.pdf$/);
    expect(mockState.storedPdfs[paths[0]].buffer.length).toBeGreaterThan(1000);

    const dq = Object.values(mockState.dqFiles);
    expect(dq).toHaveLength(1);
    expect(dq[0].fileType).toBe('Application for Employment');
    expect(dq[0].url).toBeNull();
    expect(dq[0].requiresAuditedAccess).toBe(true);

    expect(applicationDoc().submissionRecord.pdfPreserved).toBe(true);
  });

  it('renders a redelivery from the STORED snapshot, not a freshly rebuilt one', async () => {
    // The redelivery arrives with the same attempt id, so the snapshot writer
    // returns the existing record. Rendering the in-memory rebuild would stamp a
    // different submission time — and could pick up company or question changes
    // made since — so the preserved PDF would not be the application it claims
    // to represent.
    await submit({ submissionAttemptId: 'attempt-1' });
    const storedPath = Object.keys(mockState.storedPdfs)[0];
    const firstBytes = mockState.storedPdfs[storedPath].buffer;

    // Between the two deliveries the company renames itself. The stored record
    // still says what it said.
    mockState.publicProfile = {
      companyName: 'Renamed Carrier LLC',
      applicationConfig: {
        cdlUpload: { hidden: false, required: false },
        medCardUpload: { hidden: false, required: false },
      },
      customQuestions: [],
    };

    await submit({ submissionAttemptId: 'attempt-1' });

    expect(Object.keys(mockState.storedPdfs)).toHaveLength(1);
    expect(mockState.storedPdfs[storedPath].buffer).toBe(firstBytes);
    // One preserved record, one preserved document, no second "original".
    expect(Object.keys(mockState.snapshots)).toHaveLength(1);
  });

  it('keeps the application when preserving the PDF fails', async () => {
    const bucket = require('../../firebaseAdmin').storage.bucket;
    const spy = jest.spyOn(require('../../firebaseAdmin').storage, 'bucket').mockImplementation(() => ({
      file: () => ({
        exists: async () => [false],
        save: async () => { throw new Error('storage unavailable'); },
      }),
    }));

    const result = await submit();

    expect(result.applicationId).toBeTruthy();
    expect(applicationDoc().submissionRecord.status).toBe('recorded');
    expect(applicationDoc().submissionRecord.pdfPreserved).toBe(false);
    spy.mockRestore();
    expect(typeof bucket).toBe('function');
  });
});
