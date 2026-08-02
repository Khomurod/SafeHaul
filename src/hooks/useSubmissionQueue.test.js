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
