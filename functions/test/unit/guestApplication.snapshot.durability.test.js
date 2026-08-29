/**
 * A snapshot failure must not lose the application, one submission stays one
 * preserved record, and every submission says whether it was preserved.
 *
 * Part of the guest-application snapshot suite. The in-memory Firestore, the
 * fixtures and the reset are in `guestApplication.snapshot.support.js`. Each
 * `jest.mock` below has to stay in this file, because Jest hoists it per file
 * and cannot register one from a helper.
 */
jest.mock('firebase-functions/v1', () => require('./guestApplication.snapshot.support').httpsMock());
jest.mock('firebase-admin/firestore', () => require('./guestApplication.snapshot.support').firestoreFieldValueMock());
jest.mock('../../firebaseAdmin', () => require('./guestApplication.snapshot.support').firebaseAdminMock());
jest.mock('../../shared/companyTenant', () => require('./guestApplication.snapshot.support').companyTenantMock());
jest.mock('../../shared/rateLimiter', () => require('./guestApplication.snapshot.support').rateLimiterMock());

const { submitGuestApplication } = require('../../guestApplication');
const {
   mockState, payload, ctx, storedSnapshots, onlySnapshot, resetSnapshotState,
} = require('./guestApplication.snapshot.support');

beforeEach(resetSnapshotState);

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
