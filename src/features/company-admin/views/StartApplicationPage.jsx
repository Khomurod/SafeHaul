import React, { useCallback, useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { ArrowLeft, ArrowRight, Plus, Save } from 'lucide-react';

import { functions } from '@lib/firebase';
import { useData } from '@/context/DataContext';
import { Button, Card, FieldMessage } from '@/design-system/components';
import { PageContainer, PageHeader, Stack } from '@/design-system/layouts';
import { useGuestFileUpload } from '@features/driver-app/hooks/useGuestFileUpload';
import { useApplicationPrepDraft, describeError } from '../applicationPrep/useApplicationPrepDraft';
import { useInviteLink } from '../applicationPrep/useInviteLink';
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
                            <Plus size={14} aria-hidden="true" /> Start an application
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
                            formData={prep.formData}
                            onUpload={uploadDocument}
                            onChange={onFileChange}
                        />
                    </Card>
                    <ApplicationAiPrepPanel
                        companyId={companyId}
                        files={prep.formData}
                        blobs={documentBlobs}
                        formData={prep.formData}
                        onApply={prep.setFormData}
                        onLockCarriers={prep.lockEmployers}
                    />
                    {prep.error && <Card padding="md"><FieldMessage tone="error">{prep.error}</FieldMessage></Card>}
                    <div className="flex flex-wrap gap-ds-2">
                        <Button variant="ghost" onClick={() => setView('mode')}>
                            <ArrowLeft size={14} aria-hidden="true" /> Back
                        </Button>
                        <Button variant="primary" onClick={() => setView('editor')} disabled={isUploading}>
                            Continue to review &amp; edit <ArrowRight size={14} aria-hidden="true" />
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
                        <ArrowLeft size={14} aria-hidden="true" /> Back to the list
                    </Button>
                    <Button variant="secondary" onClick={prep.save} disabled={!prep.identityComplete || prep.busy || isUploading}>
                        <Save size={14} aria-hidden="true" /> {prep.busy ? 'Saving…' : 'Save'}
                    </Button>
                </div>

                {readOnlyNotice && <Card padding="md"><FieldMessage tone="help">{readOnlyNotice}</FieldMessage></Card>}
                {prep.error && <Card padding="md"><FieldMessage tone="error">{prep.error}</FieldMessage></Card>}

                {!readOnlyNotice && intakeMode === 'ai' && (
                    <ApplicationAiPrepPanel
                        companyId={companyId}
                        files={prep.formData}
                        blobs={documentBlobs}
                        formData={prep.formData}
                        onApply={prep.setFormData}
                        onLockCarriers={prep.lockEmployers}
                    />
                )}

                {!readOnlyNotice && (
                    <ApplicationPrepEditor
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

                <InviteLinkPanel
                    link={invite.linkFor(prep.applicantKey)}
                    busy={invite.busy}
                    error={invite.error}
                    copied={invite.copied}
                    canMint={Boolean(prep.applicantKey)}
                    onMint={() => invite.mint(prep.applicantKey)}
                    onCopy={invite.copy}
                />
            </Stack>
        </PageContainer>
    );
}

export default StartApplicationPage;
