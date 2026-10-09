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
import { closeDraftAfterDelayedSubmission } from '../features/driver-app/services/applicationDraftService';
import { readDiscardMark } from '../features/driver-app/components/application/applicationDraftStorage';
import { isPermanentRefusal } from '../features/driver-app/components/application/publicApplyRefusal';
import {
    announceQueuedApplication,
    queuedOutcome,
} from '../features/driver-app/components/application/queuedApplicationOutcome';

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
            // Discarded since this was queued, so it must not be sent. A submission
            // creates an immutable application, and an entry can sit here long after the
            // tab that made it stopped existing — a `queued` screen that a discard
            // deliberately leaves alone, or a closed tab — so nothing else is in a
            // position to cancel it. Returning drops the entry, which is the intent:
            // there is nothing left to deliver.
            if (entry?.applySlug && entry?.applyDiscardMark !== undefined
                && readDiscardMark(entry.applySlug) !== entry.applyDiscardMark) {
                Sentry.addBreadcrumb({
                    category: 'queue',
                    message: 'Queued guest submission dropped: the application was discarded',
                    data: { companyId },
                    level: 'info',
                });
                return { dropped: true };
            }

            const submitFn = httpsCallable(functions, 'submitGuestApplication');
            const sent = submitFn({
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
                // The day the applicant pressed Submit, exactly as the direct attempt
                // sent it. Without it a replay is judged on the server's UTC day, which
                // can be the wrong week for an evening Hours of Service statement. An
                // entry queued before the field existed sends nothing, and the server
                // uses its own day.
                ...(entry?.applicantToday ? { applicantToday: entry.applicantToday } : {}),
                // Which of a Company Admin's edits these answers have taken, as the
                // direct attempt said; an entry queued before this was kept says none.
                ...(Number.isInteger(entry?.seenRevision) ? { seenRevision: entry.seenRevision } : {}),
            });
            // A refusal is the server's answer, not a delivery that failed: the queue
            // stops at it and keeps the reason for the page (`final`).
            const result = await sent.catch((error) => {
                throw isPermanentRefusal(error) ? Object.assign(error, { final: true }) : error;
            });

            // The submission landed, so the server has just deleted the draft behind
            // it. Nothing else will say so: other tabs of this apply page may still be
            // holding these answers in memory, and without the mark they would be free
            // to submit them a second time or autosave the draft back into existence.
            // This hook already knows guest applications specifically — it is the only
            // thing that knows a queued one has *succeeded*, and it may be a different
            // tab, or a different day, from the one that queued it.
            // Verified, not unconditional: `applySlug` names the apply page, and by
            // now the applicant may have started a *new* application there. Clearing
            // that would destroy work they never sent — worse than the duplicate
            // submission this guards against — so the close happens only when storage
            // still holds the application this entry was made from.
            if (entry?.applySlug) {
                closeDraftAfterDelayedSubmission(entry.applySlug, {
                    draftId: entry.applyDraftId || null,
                });
            }

            Sentry.addBreadcrumb({
                category: 'queue',
                message: 'Queued guest submission processed via Cloud Function',
                data: { companyId },
                level: 'info',
            });
            return result;
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
            // A guest application that ended, told to its page (and kept for it).
            for (const { entry, outcome, result, error } of results?.settled || []) {
                if (!entry?.applySlug || result?.dropped) continue;
                announceQueuedApplication(queuedOutcome(entry, outcome, { result, error }));
            }

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

    // Refresh pending count periodically, and send what is due. Without this a
    // replay that failed waited for the connection to drop and come back, or for a
    // reload: its retry time passing started nothing.
    const processQueueNowRef = useRef(processQueueNow);
    processQueueNowRef.current = processQueueNow;
    useEffect(() => {
        if (!isSupported()) return;

        const refreshCount = async () => {
            try {
                const pending = await getAllPending();
                setPendingCount(pending.length);
                const due = pending.some((entry) => !entry.nextRetryAt || entry.nextRetryAt <= Date.now());
                if (due && navigator.onLine && isInitialized.current) processQueueNowRef.current();
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
