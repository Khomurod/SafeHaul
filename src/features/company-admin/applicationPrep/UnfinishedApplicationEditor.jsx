import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { Icon, RefreshCw } from '@design-system/icons';

import { functions } from '@lib/firebase';
import { Button, Notice } from '@/design-system/components';
import { ConfirmDialog } from '@design-system/patterns';
import { useGuestFileUpload } from '@features/driver-app/hooks/useGuestFileUpload';
import { UnfinishedEditorSections } from './UnfinishedEditorSections';
import { changedSectionTitles, editRequest } from './unfinishedEditorModel';

/**
 * A Company Admin correcting or completing an unfinished application the driver
 * owns.
 *
 * ## How an edit reaches the driver
 *
 * The driver fills the application in on their own device, so the server
 * records an edit as one (`functions/shared/companyEdits.js`): the driver's page
 * takes the edited answers, names them above every step, and asks for the
 * signature again when one changed. What the driver alone gives is never offered
 * here (`unfinishedEditorModel.js`).
 *
 * ## What it sends
 *
 * Only the answers that changed, each beside the value it loaded. An answer the
 * driver changed in the meantime is refused rather than overwritten, and the
 * admin reloads to see it before deciding again; nothing on screen is lost
 * until they choose to.
 */

/** A save that failed, in words an admin can act on. */
function describeSaveError(error) {
    switch (error?.code) {
        case 'functions/aborted':
        case 'functions/not-found':
            // The server's sentence names what happened; reloading is the answer.
            return { message: error.message, reload: true };
        case 'functions/failed-precondition':
        case 'functions/invalid-argument':
            return { message: error.message };
        case 'functions/permission-denied':
            return { message: 'Only a Company Admin can change an application the driver is filling in.' };
        case 'functions/unauthenticated':
            return { message: 'Your session has ended. Sign in again to continue.' };
        case 'functions/resource-exhausted':
            return { message: 'Too many saves in a row. Wait a moment and try again.' };
        default:
            return { message: 'Your changes could not be saved. Try again.' };
    }
}

export function UnfinishedApplicationEditor({ companyId, view, onSaved, onCancel, onReload }) {
    const loaded = useMemo(() => view?.answers || {}, [view]);
    const [answers, setAnswers] = useState(loaded);
    const [saving, setSaving] = useState(false);
    const [failure, setFailure] = useState(null);
    const [confirmingDiscard, setConfirmingDiscard] = useState(false);
    // A document still uploading is not an answer yet, so Save waits for it.
    const { handleFileUpload, isUploading } = useGuestFileUpload(companyId);
    /** Focus moves into the editor when it opens; the button that opened it is gone. */
    const rootRef = useRef(null);
    useEffect(() => { rootRef.current?.focus(); }, []);

    /** One answer, or an updater over it, as the wizard's sections write them. */
    const update = useCallback((key, value) => {
        setAnswers((previous) => ({
            ...previous,
            [key]: typeof value === 'function' ? value(previous[key]) : value,
        }));
    }, []);

    const request = useMemo(() => editRequest(answers, loaded), [answers, loaded]);
    const changedFields = Object.keys(request.changes);
    const changedTitles = changedSectionTitles(changedFields);

    const save = async () => {
        setSaving(true);
        setFailure(null);
        try {
            const call = httpsCallable(functions, 'saveApplicationDraftEdits');
            const { data } = await call({ companyId, applicantKey: view.applicantKey, ...request });
            onSaved(data);
        } catch (error) {
            setFailure(describeSaveError(error));
            setSaving(false);
        }
    };

    const cancel = () => {
        if (changedFields.length > 0) setConfirmingDiscard(true);
        else onCancel();
    };

    return (
        <div ref={rootRef} tabIndex={-1} role="region" aria-label="Edit answers" className="space-y-ds-6 rounded-ds-lg focus-visible:outline-none focus-visible:shadow-ds-focus">
            <Notice tone="info" title="Your changes go to the driver">
                The next time the driver opens the application they are shown what you changed, before they sign.
                Only the driver can change their email, phone, last name, date of birth, Social Security Number,
                signature, consents and hours-of-service statement.
            </Notice>

            <UnfinishedEditorSections
                answers={answers}
                update={update}
                form={view?.form}
                loaded={loaded}
                companyId={companyId}
                onUpload={handleFileUpload}
            />

            {failure && (
                <Notice
                    tone="danger"
                    title="Not saved"
                    announce="assertive"
                    actions={failure.reload ? (
                        <Button variant="secondary" size="sm" onClick={onReload}>
                            <Icon icon={RefreshCw} size="sm" /> Reload the application
                        </Button>
                    ) : undefined}
                >
                    {failure.message}
                </Notice>
            )}

            <div className="flex flex-wrap items-center gap-ds-3">
                <Button variant="primary" onClick={save} disabled={changedFields.length === 0 || saving || isUploading} loading={saving}>
                    Save changes
                </Button>
                <Button variant="secondary" onClick={cancel} disabled={saving}>
                    Cancel
                </Button>
                <p className="text-ds-sm text-ds-content-muted" aria-live="polite">
                    {isUploading && 'Uploading… '}
                    {changedTitles.length > 0 ? `Changed: ${changedTitles.join(', ')}` : 'No changes yet'}
                </p>
            </div>

            {confirmingDiscard && (
                <ConfirmDialog
                    tone="warning"
                    title="Discard your changes?"
                    description="What you changed here has not been saved. The application stays as it was."
                    confirmLabel="Discard changes"
                    cancelLabel="Keep editing"
                    onConfirm={onCancel}
                    onCancel={() => setConfirmingDiscard(false)}
                />
            )}
        </div>
    );
}

export default UnfinishedApplicationEditor;
