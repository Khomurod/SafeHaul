import React, { useCallback, useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { Icon, ArrowLeft, ArrowRight, Plus, Save } from '@design-system/icons';

import { functions } from '@lib/firebase';
import { useData } from '@/context/DataContext';
import { Button, Card, FieldMessage } from '@/design-system/components';
import { PageContainer, PageHeader, Stack } from '@/design-system/layouts';
import { useGuestFileUpload } from '@features/driver-app/hooks/useGuestFileUpload';
import { useApplicationPrepDraft, describeError } from '../applicationPrep/useApplicationPrepDraft';
import { useInviteLink } from '../applicationPrep/useInviteLink';
import { PREP_ACTIONS, prepActionPreflight } from '../applicationPrep/prepActionPreflight';
import ApplicationModeChooser from '../applicationPrep/ApplicationModeChooser';
import ApplicationDocumentsPanel from '../applicationPrep/ApplicationDocumentsPanel';
import ApplicationPrepEditor from '../applicationPrep/ApplicationPrepEditor';
import ApplicationAiPrepPanel from '../applicationPrep/ApplicationAiPrepPanel';
import InviteLinkPanel from '../applicationPrep/InviteLinkPanel';
import PreparedApplicationsTable from '../applicationPrep/PreparedApplicationsTable';

/**
 * Starting a driver's application for them.
 *
 * ## Why a carrier can do this at all
 *
 * A recruiter often has the driver's paperwork — licence, medical card, PSP
 * report, motor vehicle record — before the driver has typed a word. The only way
 * in used to be the driver's own nine-page wizard, so all of it was retyped by the
 * person least likely to have the documents in front of them.
 *
 * ## What it is not
 *
 * It is not an application. Nothing here is signed, consented to, or agreed by the
 * driver, and none of it enters the pipeline: it is staged as a draft, exactly
 * where an unfinished application already lives, and becomes an application only
 * when the driver completes it and signs it themselves.
 *
 * ## The two ways in
 *
 * A new application first asks how to fill it: **AI** (upload the documents, the
 * reader fills what it can) or **manually** (type it). Both land in one editable
 * form where the email and phone — the fields that key the draft — are entered.
 * The only fields a driver cannot later change are the employers a PSP report
 * named, which stay locked to their identity.
 */
/**
 * Move focus to a field the preflight named.
 *
 * `SchemaRenderer` suffixes its ids with `-edit` in edit mode, which is the mode
 * this screen is always in — the driver's wizard renders the same fields as
 * `#email`, which is what the e2e specs there point at. The preflight names the
 * logical field and this resolves it, so neither has to know about the other's
 * renderer. Tried in that order because this screen only ever has the first.
 */
function focusPrepField(fieldId) {
    const field = document.getElementById(`${fieldId}-edit`) || document.getElementById(fieldId);
    field?.focus();
}

export function StartApplicationPage() {
    const { currentCompanyProfile } = useData();
    const companyId = currentCompanyProfile?.id;
    const appSlug = currentCompanyProfile?.appSlug || companyId;

    // list → mode → (upload, AI only) → editor.
    const [view, setView] = useState('list');
    const [intakeMode, setIntakeMode] = useState('ai');
    /**
     * The `File` objects this tab holds, keyed by upload field. An upload puts
     * `{name, url, storagePath}` into the form data and sends the bytes to Storage,
     * so the reader — which needs bytes — has nothing unless they are kept. As
     * long-lived as this tab: a draft re-opened tomorrow has the documents on the
     * application and nothing here, and the reader panel says so.
     */
    const [documentBlobs, setDocumentBlobs] = useState({});
    const [applications, setApplications] = useState([]);
    const [listLoading, setListLoading] = useState(true);
    const [listError, setListError] = useState(null);
    const [readOnlyNotice, setReadOnlyNotice] = useState(null);
    /**
     * The reader is running, on whichever step is mounted.
     *
     * Held here rather than in the panel because there are two instances of it —
     * one on the upload step, one in the editor — and moving between them unmounts
     * the first and mounts the second as idle. A read started on the upload step
     * would otherwise let a second one start in the editor while it was still in
     * flight.
     */
    const [readerBusy, setReaderBusy] = useState(false);
    /**
     * What the last press of an action found missing.
     *
     * Save and "Create the driver's link" used to be `disabled` whenever their
     * prerequisites were unmet, with nothing on screen saying what those were —
     * and the link's real precondition, "save first", appeared nowhere at all. The
     * controls are clickable now and the press explains itself. See
     * `prepActionPreflight`.
     */
    const [actionProblem, setActionProblem] = useState(null);

    const prep = useApplicationPrepDraft(companyId);
    const invite = useInviteLink({ companyId, appSlug });
    const { handleFileUpload, isUploading } = useGuestFileUpload(companyId);

    const loadList = useCallback(async () => {
        if (!companyId) return;
        setListLoading(true);
        setListError(null);
        try {
            const call = httpsCallable(functions, 'listCompanyPreparedApplications');
            const { data } = await call({ companyId });
            setApplications(data?.applications || []);
        } catch (error) {
            setListError(describeError(error));
            setApplications([]);
        } finally {
            setListLoading(false);
        }
    }, [companyId]);

    useEffect(() => { loadList(); }, [loadList]);

    // Everything this hook holds belongs to one applicant, and the email/phone in it
    // key the draft — so a fresh start clears all of it before the next one, or one
    // driver's answers, documents and locks save under another driver's key.
    const clearForNew = useCallback(() => {
        prep.reset();
        invite.reset();
        setDocumentBlobs({});
        setReadOnlyNotice(null);
        setReaderBusy(false);
    }, [invite, prep]);

    const startNew = useCallback(() => { clearForNew(); setView('mode'); }, [clearForNew]);
    const chooseManual = useCallback(() => { setIntakeMode('manual'); setView('editor'); }, []);
    const chooseAi = useCallback(() => { setIntakeMode('ai'); setView('upload'); }, []);

    const openExisting = useCallback(async (entry) => {
        // The previous application's link and documents go first — both are keyed to
        // one driver.
        invite.reset();
        setDocumentBlobs({});
        const result = await prep.load(entry.applicantKey);
        if (!result) return;
        // Once the driver has started, the answers are theirs — the screen says why
        // the fields are empty rather than showing a blank form as if nothing had
        // been filled in.
        setReadOnlyNotice(result.readable
            ? null
            : 'This driver has started filling it in, so their answers are theirs now. You can still see how far they have got.');
        setIntakeMode('ai');
        setView('editor');
    }, [invite, prep]);

    /**
     * Run an action, or say what it needs.
     *
     * Focus moves to the first field at fault — schema fields carry `id={key}`, so
     * `#email` and `#phone` are the real controls, which is what the e2e specs
     * already rely on.
     */
    const attempt = useCallback(async (action, run) => {
        const verdict = prepActionPreflight(action, {
            formData: prep.formData,
            applicantKey: prep.applicantKey,
            dirty: prep.dirty,
            hasLink: Boolean(invite.linkFor(prep.applicantKey)),
        });
        if (!verdict.ok) {
            setActionProblem({ ...verdict, action });
            const target = verdict.problems.find((problem) => problem.fieldId)?.fieldId;
            if (target) focusPrepField(target);
            return null;
        }
        setActionProblem(null);
        return run();
    }, [invite, prep.applicantKey, prep.dirty, prep.formData]);

    const saveNow = useCallback(() => attempt(PREP_ACTIONS.SAVE, prep.save), [attempt, prep.save]);

    /** Save, then mint — the one press the "save first" message would otherwise cost. */
    const saveThenLink = useCallback(async () => {
        setActionProblem(null);
        const saved = await prep.save();
        if (!saved?.applicantKey) return;
        await invite.mint(saved.applicantKey);
    }, [invite, prep]);

    const createLink = useCallback(
        () => attempt(PREP_ACTIONS.LINK, () => invite.mint(prep.applicantKey)),
        [attempt, invite, prep.applicantKey],
    );

    const copyLink = useCallback(
        () => attempt(PREP_ACTIONS.COPY, invite.copy),
        [attempt, invite],
    );

    const uploadDocument = useCallback(async (fieldName, file) => {
        const uploaded = await handleFileUpload(fieldName, file);
        // Only once the upload succeeded: a blob the application does not hold is a
        // document the driver would never see, and reading it would fill the form
        // from a file attached to nothing.
        if (uploaded) setDocumentBlobs((previous) => ({ ...previous, [fieldName]: file }));
        return uploaded;
    }, [handleFileUpload]);

    const onFileChange = useCallback((name, value) => {
        prep.updateField(name, value);
        if (value) return;
        setDocumentBlobs((previous) => {
            if (!previous[name]) return previous;
            const next = { ...previous };
            delete next[name];
            return next;
        });
    }, [prep]);

    const updateList = useCallback((key, value) => prep.updateField(key, value), [prep]);
    const backToList = useCallback(() => { setView('list'); loadList(); }, [loadList]);

    const driverName = [prep.formData.firstName, prep.formData.lastName].filter(Boolean).join(' ');
    // Once a link exists — minted this session, or a loaded draft already `sent` —
    // the email and phone that key the draft are fixed: re-keying would strand the
    // link the driver already has. The editor renders them read-only.
    const identityLocked = prep.status === 'sent' || Boolean(invite.link);

    if (view === 'list') {
        return (
            <PageContainer>
                <Stack gap="lg">
                    <PageHeader
                        title="Start an application"
                        description="Fill in what you already know from a driver's paperwork, then send them a link to finish and sign it. Nothing is filed until they do."
                    />
                    <div className="flex flex-wrap gap-ds-2">
                        <Button variant="primary" onClick={startNew} disabled={!companyId}>
                            <Icon icon={Plus} size="sm" /> Start an application
                        </Button>
                    </div>
                    {listError && <Card padding="md"><FieldMessage tone="error">{listError}</FieldMessage></Card>}
                    <PreparedApplicationsTable
                        applications={applications}
                        loading={listLoading}
                        onOpen={openExisting}
                    />
                </Stack>
            </PageContainer>
        );
    }

    if (view === 'mode') {
        return (
            <PageContainer>
                <Stack gap="lg">
                    <PageHeader
                        title="How do you want to fill this in?"
                        description="Let the reader take what it can from the driver's documents, or type it yourself. Either way you review and edit everything before the driver ever sees it."
                    />
                    <ApplicationModeChooser onChooseAi={chooseAi} onChooseManual={chooseManual} />
                    <div><Button variant="ghost" onClick={() => setView('list')}>Cancel</Button></div>
                </Stack>
            </PageContainer>
        );
    }

    if (view === 'upload') {
        return (
            <PageContainer>
                <Stack gap="lg">
                    <PageHeader
                        title="Upload the driver's documents"
                        description="Attach any of these — one, some or all. The reader takes what it can from them; you fill in and correct the rest next."
                    />
                    <Card padding="md">
                        <ApplicationDocumentsPanel
                            companyId={companyId}
                            formData={prep.formData}
                            onUpload={uploadDocument}
                            onChange={onFileChange}
                        />
                    </Card>
                    <ApplicationAiPrepPanel
                        companyId={companyId}
                        files={prep.formData}
                        blobs={documentBlobs}
                        applicantKey={prep.applicantKey}
                        onApplyExtraction={prep.applyExtraction}
                        busy={readerBusy}
                        onBusyChange={setReaderBusy}
                    />
                    {prep.error && <Card padding="md"><FieldMessage tone="error">{prep.error}</FieldMessage></Card>}
                    <div className="flex flex-wrap gap-ds-2">
                        <Button variant="ghost" onClick={() => setView('mode')}>
                            <Icon icon={ArrowLeft} size="sm" /> Back
                        </Button>
                        <Button variant="primary" onClick={() => setView('editor')} disabled={isUploading}>
                            Continue to review &amp; edit <Icon icon={ArrowRight} size="sm" />
                        </Button>
                    </div>
                </Stack>
            </PageContainer>
        );
    }

    return (
        <PageContainer>
            <Stack gap="lg">
                <PageHeader
                    title={driverName || 'Application'}
                    description="Fill in what you know, including the driver's email and phone. The driver completes the rest, reviews all of it, and signs."
                />
                <div className="flex flex-wrap gap-ds-2">
                    <Button variant="ghost" onClick={backToList}>
                        <Icon icon={ArrowLeft} size="sm" /> Back to the list
                    </Button>
                    {/* Clickable even when something is missing: the press says what.
                        `loading` is the one honest `disabled` — an operation in
                        flight — and it brings the spinner and `aria-busy` with it.
                        The LABEL stays "Save": a label that changes to "Saving…" is
                        ordinary content rather than an announcement, and it moves
                        the control's accessible name out from under anything
                        looking for it. The live region beside it is what speaks,
                        and it exists when idle so that filling it is announced. */}
                    <Button variant="secondary" onClick={saveNow} loading={prep.busy || isUploading}>
                        <Icon icon={Save} size="sm" /> Save
                    </Button>
                    <p role="status" className="self-center text-ds-xs text-ds-content-secondary">
                        {prep.busy ? 'Saving…' : ''}
                    </p>
                </div>

                {actionProblem && (
                    <Card padding="md">
                        {/* No `role="alert"` here: `FieldMessage tone="error"` sets
                            its own, and nesting one alert inside another announces
                            the same text twice. The primitive owns the region. */}
                        <div className="space-y-ds-2">
                            {actionProblem.problems.map((problem) => (
                                <FieldMessage key={problem.message} tone="error">{problem.message}</FieldMessage>
                            ))}
                            {actionProblem.needsSave && actionProblem.action === PREP_ACTIONS.LINK && (
                                <Button variant="primary" size="sm" onClick={saveThenLink} loading={prep.busy}>
                                    <Icon icon={Save} size="sm" /> Save and create the link
                                </Button>
                            )}
                        </div>
                    </Card>
                )}

                {readOnlyNotice && <Card padding="md"><FieldMessage tone="help">{readOnlyNotice}</FieldMessage></Card>}
                {prep.error && <Card padding="md"><FieldMessage tone="error">{prep.error}</FieldMessage></Card>}

                {!readOnlyNotice && intakeMode === 'ai' && (
                    <ApplicationAiPrepPanel
                        companyId={companyId}
                        files={prep.formData}
                        blobs={documentBlobs}
                        applicantKey={prep.applicantKey}
                        onApplyExtraction={prep.applyExtraction}
                        busy={readerBusy}
                        onBusyChange={setReaderBusy}
                    />
                )}

                {!readOnlyNotice && (
                    <ApplicationPrepEditor
                        companyId={companyId}
                        formData={prep.formData}
                        updateField={prep.updateField}
                        updateList={updateList}
                        lockedEmployers={prep.lockedEmployers}
                        onLockEmployers={prep.lockEmployers}
                        onUnlockEmployer={prep.unlockEmployer}
                        onUpload={uploadDocument}
                        onFileChange={onFileChange}
                        identityLocked={identityLocked}
                    />
                )}

                {/*
                  * Deliberately outside the `!readOnlyNotice` guard its two
                  * neighbours carry. A driver who has taken the application over
                  * may still have lost their link, and the boundary that used to
                  * make this button dangerous is now enforced server-side: after
                  * takeover the exchange returns no answers and no resume token.
                  * The panel says so rather than implying a read it cannot do.
                  */}
                <InviteLinkPanel
                    link={invite.linkFor(prep.applicantKey)}
                    busy={invite.busy}
                    error={invite.error}
                    copied={invite.copied}
                    copyFailed={invite.copyFailed}
                    driverStarted={prep.status === 'driver_in_progress'}
                    onMint={createLink}
                    onCopy={copyLink}
                />
            </Stack>
        </PageContainer>
    );
}

export default StartApplicationPage;
