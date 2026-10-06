import React, { useCallback, useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { Icon, ArrowLeft, RefreshCw } from '@design-system/icons';

import { functions } from '@lib/firebase';
import { Button, FieldDisplay, Notice } from '@/design-system/components';
import { ErrorState, LoadingState } from '@/design-system/patterns';
import { PageContainer, PageHeader, Stack } from '@/design-system/layouts';
import { PreservedApplicationView } from '@features/applications/components/PreservedApplicationView';
import { presentSubmission } from '@features/applications/services/submissionPresenter';
import { describeApplicant, describeUnfinishedRow } from './unfinishedRowActions';

/**
 * An unfinished application the driver has written, read-only, for a Company
 * Admin.
 *
 * ## Why this exists
 *
 * Until 2026-10-06 the carrier could see only that a driver had started and how
 * far they had got. The owner decided that a Company Admin sees what the driver
 * has filled in, so a follow-up call can start from it. This is that view:
 * `getApplicationDraft`'s record, through the presenter and the view a submitted
 * application uses (`presentSubmission`, `PreservedApplicationView`), so the
 * answers read the way they will once the driver submits.
 *
 * ## What it does not do
 *
 * Change anything. There is no editor and no save; opening it does not extend
 * the 30 days, and the driver's link hands over exactly what it did before.
 * Recruiters never reach it: `unfinishedRowActions.js` offers it to a Company
 * Admin alone, and the server refuses anyone else.
 */

/** A callable failure, in words an admin can act on. */
function describeError(error) {
    switch (error?.code) {
        case 'functions/not-found':
            // The server's sentence: submitted, deleted or expired, said once.
            return error.message;
        case 'functions/permission-denied':
            return 'Only a Company Admin can open an application the driver is filling in.';
        case 'functions/unauthenticated':
            return 'Your session has ended. Sign in again to continue.';
        case 'functions/resource-exhausted':
            return 'Too many applications opened in a row. Wait a moment and try again.';
        default:
            return 'The application could not be loaded. Try again.';
    }
}

export function UnfinishedApplicationReview({ companyId, entry, onExit }) {
    const [state, setState] = useState({ status: 'loading' });
    const applicantKey = entry?.applicantKey;

    const load = useCallback(async () => {
        setState({ status: 'loading' });
        try {
            const call = httpsCallable(functions, 'getApplicationDraft');
            const { data } = await call({ companyId, applicantKey });
            const record = presentSubmission(data?.record);
            // A record the presenter cannot lay out is a failure, not an empty
            // application: its own empty state speaks of a submission.
            if (!record.isPreserved) throw new Error('The record could not be laid out.');
            setState({ status: 'ready', summary: data, record });
        } catch (error) {
            setState({ status: 'error', message: describeError(error), missing: error?.code === 'functions/not-found' });
        }
    }, [applicantKey, companyId]);

    useEffect(() => { load(); }, [load]);

    const back = (
        <Button variant="ghost" onClick={onExit}>
            <Icon icon={ArrowLeft} size="sm" /> Back to unfinished applications
        </Button>
    );
    const summary = state.status === 'ready' ? state.summary : entry;
    const row = describeUnfinishedRow(summary);

    return (
        <PageContainer>
            <Stack gap="lg">
                <PageHeader
                    title={describeApplicant(summary).displayName}
                    description="Read-only. What the driver has filled in so far, laid out as it will read once they submit."
                />
                <div className="flex flex-wrap gap-ds-2">{back}</div>

                {state.status === 'loading' && <LoadingState title="Loading the application" />}

                {state.status === 'error' && (
                    <ErrorState
                        title={state.missing ? 'This application is no longer here' : 'The application could not be loaded'}
                        description={state.message}
                        actions={state.missing ? back : (
                            <Button variant="secondary" onClick={load}>
                                <Icon icon={RefreshCw} size="sm" /> Try again
                            </Button>
                        )}
                    />
                )}

                {state.status === 'ready' && (
                    <>
                        <Notice tone="info" title="Unfinished: nothing has been signed or submitted">
                            The Social Security Number and the signature are never saved before the driver
                            submits, so they are not shown here. Opening an unfinished application is recorded.
                        </Notice>
                        <div className="grid grid-cols-1 gap-ds-4 sm:grid-cols-2 lg:grid-cols-4">
                            <FieldDisplay label="Started by">{row.startedByLabel}</FieldDisplay>
                            <FieldDisplay label="Status">{row.statusLabel}</FieldDisplay>
                            <FieldDisplay label="Reached">{row.progressLabel}</FieldDisplay>
                            <FieldDisplay label="Last activity">
                                {summary.updatedAt ? new Date(summary.updatedAt).toLocaleString() : 'Unknown'}
                            </FieldDisplay>
                        </div>
                        <PreservedApplicationView record={state.record} openUploads />
                    </>
                )}
            </Stack>
        </PageContainer>
    );
}

export default UnfinishedApplicationReview;
