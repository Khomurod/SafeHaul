import React, { useCallback, useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { ArrowLeft, Plus, Save } from 'lucide-react';

import { functions } from '@lib/firebase';
import { useData } from '@/context/DataContext';
import { Button, Card, FieldMessage, FormSection } from '@/design-system/components';
import { PageContainer, PageHeader, Stack } from '@/design-system/layouts';
import InputField from '@shared/components/form/InputField';
import { useGuestFileUpload } from '@features/driver-app/hooks/useGuestFileUpload';
import { useApplicationPrepDraft, describeError } from '../applicationPrep/useApplicationPrepDraft';
import { useInviteLink } from '../applicationPrep/useInviteLink';
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
 * report, motor vehicle record — before the driver has typed a word. Until now the
 * only way in was the driver's own nine-page wizard, so all of it was retyped by
 * the person least likely to have the documents in front of them.
 *
 * ## What it is not
 *
 * It is not an application. Nothing here is signed, consented to, or agreed by the
 * driver, and none of it enters the pipeline: it is staged as a draft, exactly
 * where an unfinished application already lives, and becomes an application only
 * when the driver completes it and signs it themselves. Every rule that has always
 * applied to a submission still applies to this one.
 *
 * ## The email and phone are the identity, not just contact details
 *
 * They key the draft — and the application it becomes — so they are asked for
 * first and separately. A typo there does not misspell a contact detail; it
 * addresses a different application.
 */
export function StartApplicationPage() {
    const { currentCompanyProfile } = useData();
    const companyId = currentCompanyProfile?.id;
    const appSlug = currentCompanyProfile?.appSlug || companyId;

    const [view, setView] = useState('list');
    /**
     * The `File` objects this tab holds, keyed by upload field.
     *
     * An upload puts `{name, url, storagePath}` into the form data and sends the
     * bytes to Storage, so the reader — which needs bytes — has nothing to work
     * with unless they are kept. Held here rather than in the draft because they
     * are exactly as long-lived as this tab: a draft re-opened tomorrow has the
     * documents on the application and nothing in this map, and the panel says so.
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

    const openExisting = useCallback(async (entry) => {
        // The previous application's link and documents go first. Both are keyed to
        // a driver: the link is a bearer URL for one application, and the blobs are
        // the bytes behind one set of uploads.
        invite.reset();
        setDocumentBlobs({});
        const result = await prep.load(entry.applicantKey);
        if (!result) return;
        // Once the driver has started, the answers are theirs — the server sends
        // progress and contact, and the screen says why the fields are empty
        // rather than showing a blank form as if nothing had been filled in.
        setReadOnlyNotice(result.readable
            ? null
            : 'This driver has started filling it in, so their answers are theirs now. You can still see how far they have got.');
        setView('editor');
    }, [invite, prep]);

    const startNew = useCallback(() => {
        // Not just the view. The hook still holds the previous driver's identity,
        // answers, documents and locks, and the identity is what keys the draft —
        // so starting a second application without clearing it saves one driver's
        // answers under another driver's key.
        prep.reset();
        invite.reset();
        setDocumentBlobs({});
        setReadOnlyNotice(null);
        setView('identity');
    }, [invite, prep]);

    const identityComplete = Boolean(prep.identity.email || prep.identity.phone);

    const saveAndContinue = useCallback(async () => {
        const result = await prep.save();
        if (result) {
            setView('editor');
            loadList();
        }
    }, [loadList, prep]);

    const uploadDocument = useCallback(async (fieldName, file) => {
        const uploaded = await handleFileUpload(fieldName, file);
        // Only once the upload succeeded: a blob the application does not hold is
        // a document the driver would never see, and reading it would fill the
        // form from a file that is not attached to anything.
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

    if (view === 'identity') {
        return (
            <PageContainer>
                <Stack gap="lg">
                    <PageHeader
                        title="Who is this application for?"
                        description="The email and phone identify the application, so the driver's link and the record they sign are the same one. Everything else can wait."
                    />
                    <Card padding="md">
                        <FormSection title="The driver" aria-label="The driver">
                            <div className="grid grid-cols-1 gap-ds-4 sm:grid-cols-2">
                                <InputField
                                    label="First name" id="prep-first-name" name="firstName"
                                    value={prep.identity.firstName}
                                    onChange={(name, value) => prep.setIdentity((p) => ({ ...p, [name]: value }))}
                                />
                                <InputField
                                    label="Last name" id="prep-last-name" name="lastName"
                                    value={prep.identity.lastName}
                                    onChange={(name, value) => prep.setIdentity((p) => ({ ...p, [name]: value }))}
                                />
                                <InputField
                                    label="Email" id="prep-email" name="email" type="email"
                                    value={prep.identity.email}
                                    onChange={(name, value) => prep.setIdentity((p) => ({ ...p, [name]: value }))}
                                />
                                <InputField
                                    label="Phone" id="prep-phone" name="phone" type="tel"
                                    value={prep.identity.phone}
                                    onChange={(name, value) => prep.setIdentity((p) => ({ ...p, [name]: value }))}
                                />
                            </div>
                        </FormSection>
                        {prep.error && <FieldMessage tone="error">{prep.error}</FieldMessage>}
                        <div className="mt-ds-4 flex flex-wrap gap-ds-2">
                            <Button variant="primary" onClick={saveAndContinue} disabled={!identityComplete || prep.busy}>
                                Continue
                            </Button>
                            <Button variant="ghost" onClick={() => setView('list')}>Cancel</Button>
                        </div>
                    </Card>
                </Stack>
            </PageContainer>
        );
    }

    return (
        <PageContainer>
            <Stack gap="lg">
                <PageHeader
                    title={[prep.identity.firstName, prep.identity.lastName].filter(Boolean).join(' ') || 'Application'}
                    description="Fill in what you know. The driver completes the rest, reviews all of it, and signs."
                />
                <div className="flex flex-wrap gap-ds-2">
                    <Button variant="ghost" onClick={() => { setView('list'); loadList(); }}>
                        <ArrowLeft size={14} aria-hidden="true" /> Back to the list
                    </Button>
                    <Button variant="secondary" onClick={prep.save} disabled={prep.busy || isUploading}>
                        <Save size={14} aria-hidden="true" /> {prep.busy ? 'Saving…' : 'Save'}
                    </Button>
                </div>

                {readOnlyNotice && <Card padding="md"><FieldMessage tone="help">{readOnlyNotice}</FieldMessage></Card>}
                {prep.error && <Card padding="md"><FieldMessage tone="error">{prep.error}</FieldMessage></Card>}

                {!readOnlyNotice && (
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
