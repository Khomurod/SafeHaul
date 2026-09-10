import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icon, ArrowLeft, ArrowRight, Save } from '@design-system/icons';

import { Button, Card, FieldMessage } from '@/design-system/components';
import { PageContainer, PageHeader, Stack } from '@/design-system/layouts';
import { useGuestFileUpload } from '@features/driver-app/hooks/useGuestFileUpload';
import { useApplicationPrepDraft } from './useApplicationPrepDraft';
import { useInviteLink } from './useInviteLink';
import { PREP_ACTIONS, prepActionPreflight } from './prepActionPreflight';
import ApplicationModeChooser from './ApplicationModeChooser';
import ApplicationDocumentsPanel from './ApplicationDocumentsPanel';
import ApplicationPrepEditor from './ApplicationPrepEditor';
import ApplicationAiPrepPanel from './ApplicationAiPrepPanel';
import InviteLinkPanel from './InviteLinkPanel';

/**
 * Preparing one driver's application — the mode choice, the documents, the editor.
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
 *
 * ## Why it is a component and not the screen
 *
 * Split out of `StartApplicationPage` on 2026-09-10, when that screen and
 * `Started (unfinished)` became one workspace. This is the *task*; the worklist
 * around it is the *place*. `UnfinishedApplicationsPage` mounts one of these with
 * a `key` per target, which is what makes "one driver never leaks into the next"
 * structural rather than a reset somebody has to remember: a different driver is a
 * different component instance, so the answers, the documents and the minted link
 * cannot survive the move. `onExit` returns to the worklist, which reloads.
 */
function focusPrepField(fieldId) {
    // `SchemaRenderer` suffixes its ids with `-edit` in edit mode, which is the mode
    // this screen is always in — the driver's wizard renders the same fields as
    // `#email`, which is what the e2e specs there point at. The preflight names the
    // logical field and this resolves it, so neither has to know about the other's
    // renderer. Tried in that order because this screen only ever has the first.
    const field = document.getElementById(`${fieldId}-edit`) || document.getElementById(fieldId);
    field?.focus();
}

export function ApplicationPrepWorkspace({ companyId, appSlug, openKey = null, onExit }) {
    // A new application starts at the fork; an existing one opens straight into the
    // editor, because the choice of how to fill it in was made when it was created.
    const [view, setView] = useState(openKey ? 'editor' : 'mode');
    const [intakeMode, setIntakeMode] = useState('ai');
    /**
     * The `File` objects this tab holds, keyed by upload field. An upload puts
     * `{name, url, storagePath}` into the form data and sends the bytes to Storage,
     * so the reader — which needs bytes — has nothing unless they are kept. As
     * long-lived as this component: a draft re-opened tomorrow has the documents on
     * the application and nothing here, and the reader panel says so.
     */
    const [documentBlobs, setDocumentBlobs] = useState({});
    const [readOnlyNotice, setReadOnlyNotice] = useState(null);
    /**
     * The draft this instance was opened for could not be read.
     *
     * Worth its own state because the alternative is worse in both directions. The
     * previous screen returned early on a failed load and left the recruiter on the
     * list with `prep.error` rendered nowhere, so the press did nothing at all;
     * falling through to the editor instead would offer an empty editable form for
     * a record that exists, which invites typing into a draft that is not the one
     * they opened. (Nothing could be corrupted — the preflight refuses a save with
     * no email or phone — but "your edits went somewhere" is not a thing to leave
     * ambiguous.) So the error shows and the form does not.
     */
    const [loadFailed, setLoadFailed] = useState(false);
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

    /**
     * Load the draft this instance was mounted for, once.
     *
     * The ref rather than an empty dependency list: `prep` is a fresh object on
     * every render, so listing it re-runs this effect constantly and an empty list
     * would lie about that. A `key` change remounts, so "once per instance" is
     * once per target.
     *
     * ## Why the staleness guard is a mount flag and not a per-effect flag
     *
     * The obvious `let cancelled = false; return () => { cancelled = true; }` is
     * wrong here, and it fails silently. `prep.load` sets state, which re-renders,
     * which runs this effect's cleanup — cancelling the load that is still in
     * flight — and the re-run then returns early at the guard above, so nothing
     * ever revives it. The result: `setReadOnlyNotice` never fires, and a recruiter
     * opening an application the driver has taken over sees an empty form with no
     * explanation, which reads as "nothing was filled in" about work they did
     * themselves. Caught by
     * `UnfinishedApplicationsPage.prep.test.jsx` before it shipped; the flag below
     * flips only on a real unmount, which is the thing actually worth checking.
     */
    const loadedFor = useRef(null);
    const mounted = useRef(true);
    useEffect(() => () => { mounted.current = false; }, []);
    useEffect(() => {
        if (!openKey || !companyId || loadedFor.current === openKey) return;
        loadedFor.current = openKey;
        (async () => {
            const result = await prep.load(openKey);
            if (!mounted.current) return;
            if (!result) {
                setLoadFailed(true);
                return;
            }
            // Once the driver has started, the answers are theirs — the screen says
            // why the fields are empty rather than showing a blank form as if
            // nothing had been filled in.
            setReadOnlyNotice(result.readable
                ? null
                : 'This driver has started filling it in, so their answers are theirs now. You can still see how far they have got.');
        })();
    }, [companyId, openKey, prep]);

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

    const driverName = [prep.formData.firstName, prep.formData.lastName].filter(Boolean).join(' ');
    // Once a link exists — minted this session, or a loaded draft already `sent` —
    // the email and phone that key the draft are fixed: re-keying would strand the
    // link the driver already has. The editor renders them read-only.
    const identityLocked = prep.status === 'sent' || Boolean(invite.link);

    if (view === 'mode') {
        return (
            <PageContainer>
                <Stack gap="lg">
                    <PageHeader
                        title="How do you want to fill this in?"
                        description="Let the reader take what it can from the driver's documents, or type it yourself. Either way you review and edit everything before the driver ever sees it."
                    />
                    <ApplicationModeChooser
                        onChooseAi={() => { setIntakeMode('ai'); setView('upload'); }}
                        onChooseManual={() => { setIntakeMode('manual'); setView('editor'); }}
                    />
                    <div><Button variant="ghost" onClick={onExit}>Cancel</Button></div>
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
                    <Button variant="ghost" onClick={onExit}>
                        <Icon icon={ArrowLeft} size="sm" /> Back to unfinished applications
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

                {!readOnlyNotice && !loadFailed && intakeMode === 'ai' && (
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

                {!readOnlyNotice && !loadFailed && (
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
                {!loadFailed && (
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
                )}
            </Stack>
        </PageContainer>
    );
}

export default ApplicationPrepWorkspace;
