import React, { useCallback, useEffect, useRef, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { Icon, ArrowLeft, Pencil, RefreshCw } from '@design-system/icons';

import { functions } from '@lib/firebase';
import { Button, FieldDisplay, Notice } from '@/design-system/components';
import { ErrorState, LoadingState } from '@/design-system/patterns';
import { PageContainer, PageHeader, Stack } from '@/design-system/layouts';
import { PreservedApplicationView } from '@features/applications/components/PreservedApplicationView';
import { presentSubmission } from '@features/applications/services/submissionPresenter';
import { describeApplicant, describeUnfinishedRow } from './unfinishedRowActions';
import { UnfinishedApplicationEditor } from './UnfinishedApplicationEditor';
import { changedSectionTitles } from './unfinishedEditorModel';

/**
 * An unfinished application the driver has written, for a Company Admin to read
 * and correct.
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
 * ## Reading changes nothing; *Edit answers* does
 *
 * Opening it does not extend the 30 days, and the driver's link hands over
 * exactly what it did before. *Edit answers* opens `UnfinishedApplicationEditor`
 * on an application the driver owns (`editable`; the carrier's own prepared one
 * is edited in its workspace), and what it saves the driver is shown. The
 * worklist's own *Edit answers* opens this screen with `startEditing`, which
 * opens the editor once the first load says it may. Recruiters never reach
 * either: `unfinishedRowActions.js` offers this screen to a Company Admin alone,
 * and the server refuses anyone else.
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

/** The draft's view, laid out; throws when the presenter cannot lay it out. */
function readyState(data) {
    const record = presentSubmission(data?.record);
    // A record the presenter cannot lay out is a failure, not an empty
    // application: its own empty state speaks of a submission.
    if (!record.isPreserved) throw new Error('The record could not be laid out.');
    return { status: 'ready', summary: data, record };
}

export function UnfinishedApplicationReview({ companyId, entry, onExit, startEditing = false }) {
    const [state, setState] = useState({ status: 'loading' });
    const [editing, setEditing] = useState(false);
    /** Asked for the editor from the list: honoured by the first load alone, never a reload. */
    const editOnLoadRef = useRef(startEditing);
    /** What the last save changed, for the confirmation; null until one. */
    const [saved, setSaved] = useState(null);
    /** Leaving the editor puts focus back on the button that opened it. */
    const editButtonRef = useRef(null);
    const [returnFocus, setReturnFocus] = useState(false);
    const applicantKey = entry?.applicantKey;

    const load = useCallback(async () => {
        setState({ status: 'loading' });
        setEditing(false);
        try {
            const call = httpsCallable(functions, 'getApplicationDraft');
            const { data } = await call({ companyId, applicantKey });
            setState(readyState(data));
            if (editOnLoadRef.current && data?.editable === true) setEditing(true);
        } catch (error) {
            setState({ status: 'error', message: describeError(error), missing: error?.code === 'functions/not-found' });
        } finally {
            editOnLoadRef.current = false;
        }
    }, [applicantKey, companyId]);

    const onSaved = useCallback((data) => {
        try {
            setState(readyState(data));
            setSaved({ sections: changedSectionTitles(data?.changed) });
        } catch {
            // Saved, but not laid out: read it again rather than show a stale record.
            load();
        }
        setEditing(false);
        setReturnFocus(true);
    }, [load]);

    const leaveEditor = useCallback(() => {
        setEditing(false);
        setReturnFocus(true);
    }, []);

    useEffect(() => { load(); }, [load]);

    useEffect(() => {
        if (editing || !returnFocus || !editButtonRef.current) return;
        editButtonRef.current.focus();
        setReturnFocus(false);
    }, [editing, returnFocus, state.status]);

    const back = (
        <Button variant="ghost" onClick={onExit}>
            <Icon icon={ArrowLeft} size="sm" /> Back to unfinished applications
        </Button>
    );
    const summary = state.status === 'ready' ? state.summary : entry;
    const row = describeUnfinishedRow(summary);
    const canEdit = state.status === 'ready' && summary?.editable === true;

    return (
        <PageContainer>
            <Stack gap="lg">
                <PageHeader
                    title={describeApplicant(summary).displayName}
                    description={editing
                        ? 'Editing. Change or add what you know; the driver sees it the next time they open the application.'
                        : 'What the driver has filled in so far, laid out as it will read once they submit.'}
                />
                <div className="flex flex-wrap gap-ds-2">
                    {/* While editing, Save or Cancel is the way out: Cancel asks before discarding. */}
                    {!editing && back}
                    {canEdit && !editing && (
                        <Button ref={editButtonRef} variant="primary" onClick={() => { setSaved(null); setEditing(true); }}>
                            <Icon icon={Pencil} size="sm" /> Edit answers
                        </Button>
                    )}
                </div>

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

                {state.status === 'ready' && editing && (
                    <UnfinishedApplicationEditor
                        companyId={companyId}
                        view={state.summary}
                        onSaved={onSaved}
                        onCancel={leaveEditor}
                        onReload={load}
                    />
                )}

                {state.status === 'ready' && !editing && (
                    <>
                        {saved && (
                            <Notice tone="success" title={saved.sections.length > 0 ? 'Changes saved' : 'Nothing to save'} announce="polite">
                                {saved.sections.length > 0
                                    ? `You changed ${saved.sections.join(', ')}. The driver is shown what you changed the next time they open the application, before they sign.`
                                    : 'Nothing had changed since you opened the application, so nothing was saved.'}
                            </Notice>
                        )}
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
                            {summary.companyEditedAt && (
                                <FieldDisplay label="Last edited by your company">
                                    {new Date(summary.companyEditedAt).toLocaleString()}
                                </FieldDisplay>
                            )}
                        </div>
                        <PreservedApplicationView record={state.record} openUploads />
                    </>
                )}
            </Stack>
        </PageContainer>
    );
}

export default UnfinishedApplicationReview;
