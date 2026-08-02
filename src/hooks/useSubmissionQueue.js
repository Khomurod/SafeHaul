/**
 * useSubmissionQueue Hook
 * 
 * React hook for managing the submission queue with automatic recovery.
 * Monitors online/offline status and processes pending submissions
 * when connectivity is restored.
 * 
 * @module useSubmissionQueue
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { doc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@lib/firebase';
import * as Sentry from '@sentry/react';
import { mergeApplicationDoc } from '@lib/applicationWrite';

import {
    initQueue,
    getAllPending,
    getQueueCount,
    processQueue,
    isSupported,
} from '@lib/submissionQueue';

/**
 * Hook for managing the submission queue
 * 
 * @returns {Object} Queue state and controls
 */
export function useSubmissionQueue() {
    const [pendingCount, setPendingCount] = useState(0);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const [lastProcessed, setLastProcessed] = useState(null);
    const [error, setError] = useState(null);

    const isInitialized = useRef(false);
    const processingRef = useRef(false);

    // Initialize queue and get initial count
    useEffect(() => {
        if (!isSupported()) return;

        const init = async () => {
            try {
                await initQueue();
                const count = await getQueueCount();
                setPendingCount(count);
                isInitialized.current = true;
            } catch (err) {
                console.error('[useSubmissionQueue] Init failed:', err);
                setError(err.message);
            }
        };

        init();
    }, []);

    // Monitor online/offline status
    useEffect(() => {
        const handleOnline = () => {
            // Online detected
            setIsOnline(true);
        };

        const handleOffline = () => {
            // Offline detected
            setIsOnline(false);
        };

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    // Submit function for queue processing
    const submitToFirestore = useCallback(async (data, companyId, entry) => {
        const isGuest = entry?.type === 'guest' || data?.lifecycle?.isGuest;

        // Guest submissions → Cloud Function (Admin SDK, bypasses rules)
        if (isGuest) {
            const submitFn = httpsCallable(functions, 'submitGuestApplication');
            await submitFn({
                companyId: companyId,
                email: data.email || '',
                phone: data.phone || '',
                signature: data.signature || '',
                formData: {
                    ...data,
                    lifecycle: {
                        ...data.lifecycle,
                        processedFromQueue: true,
                        queueProcessedAt: new Date().toISOString(),
                    },
                },
            });

            Sentry.addBreadcrumb({
                category: 'queue',
                message: 'Queued guest submission processed via Cloud Function',
                data: { companyId },
                level: 'info',
            });
            return;
        }

        // Authenticated submissions → direct Firestore write (rules pass with auth)
        const applicationId = data.applicationId || entry.id;
        if (!companyId) {
            throw new Error('Queued submission missing a valid companyId.');
        }

        const docRef = doc(db, "companies", companyId, "applications", applicationId);

        const submissionData = {
            ...data,
            lifecycle: {
                ...data.lifecycle,
                processedFromQueue: true,
                queueProcessedAt: new Date().toISOString(),
            },
        };

        // FUNC-005 FIX: create-safe merge — a replayed authenticated submission whose
        // application already exists must not rewrite createdAt/status/confirmationNumber
        // (which the driver self-update rules reject / would clobber recruiter status).
        await mergeApplicationDoc(docRef, submissionData);

        Sentry.addBreadcrumb({
            category: 'queue',
            message: 'Queued authenticated submission processed successfully',
            data: { applicationId, companyId },
            level: 'info',
        });
    }, []);

    // Process queue when online
    const processQueueNow = useCallback(async () => {
        if (!isSupported() || !isInitialized.current) return { processed: 0 };
        if (processingRef.current) return { processed: 0 };

        const runProcessing = async () => {
        processingRef.current = true;
        setIsProcessing(true);
        setError(null);

        try {
            const pending = await getAllPending();
            if (pending.length === 0) {
                setIsProcessing(false);
                processingRef.current = false;
                return { processed: 0, succeeded: 0, failed: 0 };
            }

            // Processing queued submissions

            const results = await processQueue(submitToFirestore);

            // Update pending count
            const newCount = await getQueueCount();
            setPendingCount(newCount);
            setLastProcessed(new Date());

            if (results.succeeded > 0) {
                Sentry.captureMessage(`Queue processed: ${results.succeeded}/${results.processed} succeeded`, 'info');
            }

            return results;

        } catch (err) {
            console.error('[useSubmissionQueue] Processing failed:', err);
            setError(err.message);
            Sentry.captureException(err, { tags: { flow: 'queue_processing' } });
            return { processed: 0, succeeded: 0, failed: 0, error: err.message };

        } finally {
            setIsProcessing(false);
            processingRef.current = false;
        }
        };

        if (typeof navigator !== 'undefined' && navigator.locks?.request) {
            return navigator.locks.request('safehaul-submission-queue', runProcessing);
        }
        return runProcessing();
    }, [submitToFirestore]);

    // Auto-process when coming back online
    useEffect(() => {
        if (isOnline && pendingCount > 0 && isInitialized.current && !processingRef.current) {
            // Delay slightly to allow network to stabilize
            const timer = setTimeout(() => {
                processQueueNow();
            }, 2000);

            return () => clearTimeout(timer);
        }
    }, [isOnline, pendingCount, processQueueNow]);

    // Refresh pending count periodically
    useEffect(() => {
        if (!isSupported()) return;

        const refreshCount = async () => {
            try {
                const count = await getQueueCount();
                setPendingCount(count);
            } catch (err) {
                // Silent fail for count refresh
            }
        };

        // Refresh every 30 seconds
        const interval = setInterval(refreshCount, 30000);
        return () => clearInterval(interval);
    }, []);

    return {
        // State
        pendingCount,
        isProcessing,
        isOnline,
        lastProcessed,
        error,
        isSupported: isSupported(),

        // Actions
        processQueueNow,

        // Derived
        hasQueuedItems: pendingCount > 0,
        showQueueIndicator: pendingCount > 0 || isProcessing,
    };
}

export default useSubmissionQueue;
