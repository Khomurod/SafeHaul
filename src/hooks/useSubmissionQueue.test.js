import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSubmissionQueue } from './useSubmissionQueue';

const queueMocks = vi.hoisted(() => ({
  initQueue: vi.fn().mockResolvedValue(undefined),
  getAllPending: vi.fn().mockResolvedValue([{ id: 'q1' }]),
  getQueueCount: vi.fn().mockResolvedValue(1),
  processQueue: vi.fn(),
  isSupported: vi.fn(() => true),
}));

const firebaseFunctionMocks = vi.hoisted(() => ({
  submitGuestApplication: vi.fn().mockResolvedValue({ data: { success: true } }),
  httpsCallable: vi.fn(),
}));

const firestoreMocks = vi.hoisted(() => ({
  doc: vi.fn(() => ({ __docRef: true })),
  setDoc: vi.fn().mockResolvedValue(undefined),
  // FUNC-005: mergeApplicationDoc reads existence first. exists:false => create path.
  getDoc: vi.fn().mockResolvedValue({ exists: () => false }),
  serverTimestamp: vi.fn(() => '__server_timestamp__'),
}));

vi.mock('@lib/submissionQueue', () => ({
  initQueue: queueMocks.initQueue,
  getAllPending: queueMocks.getAllPending,
  getQueueCount: queueMocks.getQueueCount,
  processQueue: queueMocks.processQueue,
  isSupported: queueMocks.isSupported,
}));

vi.mock('@lib/firebase', () => ({
  db: {},
  functions: {},
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: firebaseFunctionMocks.httpsCallable,
}));

vi.mock('firebase/firestore', () => ({
  doc: firestoreMocks.doc,
  setDoc: firestoreMocks.setDoc,
  getDoc: firestoreMocks.getDoc,
  serverTimestamp: firestoreMocks.serverTimestamp,
}));

vi.mock('@sentry/react', () => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

describe('useSubmissionQueue frontend-backend alignment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    firebaseFunctionMocks.httpsCallable.mockReturnValue(firebaseFunctionMocks.submitGuestApplication);
    queueMocks.getAllPending.mockResolvedValue([{ id: 'q1' }]);
    queueMocks.getQueueCount.mockResolvedValue(1);
  });

  it('routes guest queue entries to submitGuestApplication with expected payload', async () => {
    queueMocks.processQueue.mockImplementationOnce(async (submitFn) => {
      await submitFn(
        {
          email: 'guest@example.com',
          phone: '5552221111',
          signature: 'data:image/png;base64,abc',
          lifecycle: { isGuest: true },
          firstName: 'Guest',
        },
        'co-guest',
        { id: 'guest-q-1', type: 'guest' },
      );
      return { processed: 1, succeeded: 1, failed: 0 };
    });

    const { result } = renderHook(() => useSubmissionQueue());
    await waitFor(() => expect(queueMocks.initQueue).toHaveBeenCalled());

    await act(async () => {
      await result.current.processQueueNow();
    });

    expect(firebaseFunctionMocks.httpsCallable).toHaveBeenCalledWith(expect.anything(), 'submitGuestApplication');
    expect(firebaseFunctionMocks.submitGuestApplication).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'co-guest',
        email: 'guest@example.com',
        phone: '5552221111',
        signature: 'data:image/png;base64,abc',
        formData: expect.objectContaining({
          firstName: 'Guest',
          lifecycle: expect.objectContaining({
            isGuest: true,
            processedFromQueue: true,
          }),
        }),
      }),
    );
    expect(firestoreMocks.setDoc).not.toHaveBeenCalled();
  });

  it('ends the draft\'s local life when a queued guest submission finally lands', async () => {
    // The queue is what learns that a submission the applicant made offline has
    // actually reached the server — possibly in a different tab, possibly a day
    // later. The server deletes the draft at that point and nothing else says so, so
    // without this every other open tab still holds these answers, free to submit
    // them a second time or autosave the draft back into existence.
    localStorage.setItem('draft_acme', JSON.stringify({ v: 1, data: { firstName: 'Ada' } }));
    localStorage.setItem('apply_resume_acme', JSON.stringify({ resumeToken: 't-1', applicantKey: 'k1' }));

    queueMocks.processQueue.mockImplementationOnce(async (submitFn) => {
      await submitFn(
        { email: 'guest@example.com', lifecycle: { isGuest: true } },
        'co-guest',
        { id: 'guest-q-2', type: 'guest', applySlug: 'acme', applyApplicantKey: 'k1' },
      );
      return { processed: 1, succeeded: 1, failed: 0 };
    });

    const { result } = renderHook(() => useSubmissionQueue());
    await waitFor(() => expect(queueMocks.initQueue).toHaveBeenCalled());
    await act(async () => { await result.current.processQueueNow(); });

    expect(localStorage.getItem('draft_acme')).toBeNull();
    expect(localStorage.getItem('apply_resume_acme')).toBeNull();
    // And the mark says *submitted*, so a tab reacting to it does not tell the
    // applicant their application was thrown away.
    expect(localStorage.getItem('apply_discarded_acme')).toMatch(/^submit:/);
  });

  it('leaves the draft alone when the queued submission fails', async () => {
    // A replay that throws is retried later, so the application has not been sent and
    // the draft is still the live record of it. Clearing it here would destroy the
    // applicant's work on a transient network failure.
    localStorage.setItem('draft_acme', JSON.stringify({ v: 1, data: { firstName: 'Ada' } }));
    firebaseFunctionMocks.submitGuestApplication.mockRejectedValueOnce(new Error('offline'));

    queueMocks.processQueue.mockImplementationOnce(async (submitFn) => {
      await submitFn(
        { email: 'guest@example.com', lifecycle: { isGuest: true } },
        'co-guest',
        { id: 'guest-q-3', type: 'guest', applySlug: 'acme', applyApplicantKey: 'k1' },
      ).catch(() => {});
      return { processed: 1, succeeded: 0, failed: 1 };
    });

    const { result } = renderHook(() => useSubmissionQueue());
    await waitFor(() => expect(queueMocks.initQueue).toHaveBeenCalled());
    await act(async () => { await result.current.processQueueNow(); });

    expect(localStorage.getItem('draft_acme')).not.toBeNull();
    expect(localStorage.getItem('apply_discarded_acme')).toBeNull();
  });

  it('does not touch any draft for an entry queued without an apply slug', async () => {
    // Entries queued before the field existed, and authenticated submissions, name no
    // apply page. Guessing one would clear a draft belonging to somebody else's
    // half-finished application.
    localStorage.setItem('draft_acme', JSON.stringify({ v: 1, data: { firstName: 'Ada' } }));

    queueMocks.processQueue.mockImplementationOnce(async (submitFn) => {
      await submitFn(
        { email: 'guest@example.com', lifecycle: { isGuest: true } },
        'co-guest',
        { id: 'guest-q-4', type: 'guest' },
      );
      return { processed: 1, succeeded: 1, failed: 0 };
    });

    const { result } = renderHook(() => useSubmissionQueue());
    await waitFor(() => expect(queueMocks.initQueue).toHaveBeenCalled());
    await act(async () => { await result.current.processQueueNow(); });

    expect(localStorage.getItem('draft_acme')).not.toBeNull();
    expect(localStorage.getItem('apply_discarded_acme')).toBeNull();
  });

  it('leaves a newer application alone when a late replay lands', async () => {
    // The entry can outlive the tab that made it. If the applicant went back to the
    // apply page and started something new before the replay landed, closing on the
    // slug alone would clear a draft they never sent and tell every open tab that
    // newer application had been submitted. Destroying unsent work is worse than the
    // duplicate submission the close exists to prevent.
    localStorage.setItem('draft_acme', JSON.stringify({ v: 1, data: { firstName: 'Newer' } }));
    localStorage.setItem('apply_resume_acme', JSON.stringify({ resumeToken: 't-2', applicantKey: 'k2' }));

    queueMocks.processQueue.mockImplementationOnce(async (submitFn) => {
      await submitFn(
        { email: 'guest@example.com', lifecycle: { isGuest: true } },
        'co-guest',
        { id: 'guest-q-5', type: 'guest', applySlug: 'acme', applyApplicantKey: 'k1' },
      );
      return { processed: 1, succeeded: 1, failed: 0 };
    });

    const { result } = renderHook(() => useSubmissionQueue());
    await waitFor(() => expect(queueMocks.initQueue).toHaveBeenCalled());
    await act(async () => { await result.current.processQueueNow(); });

    // The submission still went, and the newer application is untouched.
    expect(firebaseFunctionMocks.submitGuestApplication).toHaveBeenCalled();
    expect(localStorage.getItem('draft_acme')).not.toBeNull();
    expect(localStorage.getItem('apply_resume_acme')).not.toBeNull();
    expect(localStorage.getItem('apply_discarded_acme')).toBeNull();
  });

  it('closes an application the server never held, by its write counter', async () => {
    // Submitted while offline from the first attempt, so no resume token was ever
    // issued and there is no key to compare. The local write counter still separates
    // "the same draft" from "the applicant has typed more since".
    localStorage.setItem('draft_acme', JSON.stringify({
      v: 1, data: { firstName: 'Ada' }, meta: { localSeq: 4, syncedSeq: 0, savedAt: null },
    }));

    queueMocks.processQueue.mockImplementationOnce(async (submitFn) => {
      await submitFn(
        { email: 'guest@example.com', lifecycle: { isGuest: true } },
        'co-guest',
        { id: 'guest-q-6', type: 'guest', applySlug: 'acme', applyDraftSeq: 4 },
      );
      return { processed: 1, succeeded: 1, failed: 0 };
    });

    const { result } = renderHook(() => useSubmissionQueue());
    await waitFor(() => expect(queueMocks.initQueue).toHaveBeenCalled());
    await act(async () => { await result.current.processQueueNow(); });

    expect(localStorage.getItem('draft_acme')).toBeNull();
    expect(localStorage.getItem('apply_discarded_acme')).toMatch(/^submit:/);
  });

  it('leaves the draft alone when it has moved on since the submission was queued', async () => {
    // Same application, but the applicant kept typing after the submission was
    // queued — so what is in storage is not what was submitted.
    localStorage.setItem('draft_acme', JSON.stringify({
      v: 1, data: { firstName: 'Ada' }, meta: { localSeq: 7, syncedSeq: 0, savedAt: null },
    }));

    queueMocks.processQueue.mockImplementationOnce(async (submitFn) => {
      await submitFn(
        { email: 'guest@example.com', lifecycle: { isGuest: true } },
        'co-guest',
        { id: 'guest-q-7', type: 'guest', applySlug: 'acme', applyDraftSeq: 4 },
      );
      return { processed: 1, succeeded: 1, failed: 0 };
    });

    const { result } = renderHook(() => useSubmissionQueue());
    await waitFor(() => expect(queueMocks.initQueue).toHaveBeenCalled());
    await act(async () => { await result.current.processQueueNow(); });

    expect(localStorage.getItem('draft_acme')).not.toBeNull();
    expect(localStorage.getItem('apply_discarded_acme')).toBeNull();
  });

  it('routes authenticated queue entries to Firestore with merge write', async () => {
    queueMocks.processQueue.mockImplementationOnce(async (submitFn) => {
      await submitFn(
        {
          applicationId: 'app-auth-1',
          email: 'driver@example.com',
          lifecycle: { isGuest: false },
        },
        'co-auth',
        { id: 'auth-q-1', type: 'authenticated' },
      );
      return { processed: 1, succeeded: 1, failed: 0 };
    });

    const { result } = renderHook(() => useSubmissionQueue());
    await waitFor(() => expect(queueMocks.initQueue).toHaveBeenCalled());

    await act(async () => {
      await result.current.processQueueNow();
    });

    expect(firestoreMocks.doc).toHaveBeenCalledWith(expect.anything(), 'companies', 'co-auth', 'applications', 'app-auth-1');
    expect(firestoreMocks.setDoc).toHaveBeenCalledWith(
      { __docRef: true },
      expect.objectContaining({
        email: 'driver@example.com',
        submittedAt: '__server_timestamp__',
        lifecycle: expect.objectContaining({
          isGuest: false,
          processedFromQueue: true,
        }),
      }),
      { merge: true },
    );
  });
});
