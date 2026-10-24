import React, { useCallback, useState } from 'react';
import { Icon, Share2 } from '@design-system/icons';
import { ConfirmDialog } from '@design-system/patterns';
import { Button, Card, Notice } from '@/design-system/components';
import { PageContainer, PageHeader, Stack } from '@/design-system/layouts';
import { useData } from '@/context/DataContext';
import { isCompanyAdminForRoute } from '@app/auth/roles';
import { useToast } from '@shared/components/feedback/ToastProvider';
import { CreateReferralLinkDialog } from './CreateReferralLinkDialog';
import { ReferralLinksTable } from './ReferralLinksTable';
import { referralLinkUrl } from './referralLinksService';
import { useReferralLinks } from './useReferralLinks';

/** The name this person's links are made under: the team list's, else their sign-in. */
function creatorNameOf(profile, user) {
    const member = (profile?.teamMembers || []).find((entry) => entry.userId === user?.uid);
    return member?.name && member.name !== 'Unknown' ? member.name : user?.displayName || user?.email || '';
}

/**
 * Referral Links: a staff member makes a link for a driver who sends others to
 * apply. Whoever comes through it, by the full application or the quick
 * interest form, is assigned to the link's creator, who is notified.
 *
 * A Company Admin sees every link of the company; anyone else sees their own.
 * A link is switched off, never deleted, so what it brought stays counted.
 */
export function ReferralLinksPage() {
    const { currentCompanyProfile, currentUser, currentUserClaims } = useData();
    const companyId = currentCompanyProfile?.id;
    const isAdmin = isCompanyAdminForRoute(currentUserClaims, companyId);
    const appSlug = currentCompanyProfile?.appSlug || companyId;
    const appBaseUrl = import.meta.env.VITE_DRIVER_APP_URL || window.location.origin;
    const { showSuccess, showError } = useToast();
    const { links, counts, loading, error, reload, create, deactivate } = useReferralLinks({
        companyId, uid: currentUser?.uid, isAdmin,
    });
    const [creating, setCreating] = useState(false);
    const [deactivating, setDeactivating] = useState(null);
    const [deactivateState, setDeactivateState] = useState({ busy: false, error: null });

    const copy = useCallback(async (link) => {
        try {
            await navigator.clipboard.writeText(referralLinkUrl({ appBaseUrl, appSlug, code: link.code }));
            showSuccess(`The link for ${link.referrerName} is copied.`);
        } catch {
            showError('Could not copy the link. Your browser blocked it.');
        }
    }, [appBaseUrl, appSlug, showError, showSuccess]);

    const askDeactivate = useCallback((link) => {
        setDeactivateState({ busy: false, error: null });
        setDeactivating(link);
    }, []);

    const confirmDeactivate = async () => {
        setDeactivateState({ busy: true, error: null });
        try {
            await deactivate(deactivating.code);
            showSuccess(`The link for ${deactivating.referrerName} is switched off.`);
            setDeactivating(null);
            setDeactivateState({ busy: false, error: null });
        } catch (failure) {
            console.error('[ReferralLinksPage] deactivate failed:', failure?.code || failure?.message);
            setDeactivateState({ busy: false, error: 'We could not switch the link off. Try again.' });
        }
    };

    const createLink = async (fields) => {
        const code = await create({ ...fields, creatorName: creatorNameOf(currentCompanyProfile, currentUser) });
        showSuccess('The link is ready. Copy it and send it to the driver.');
        return code;
    };

    return (
        <PageContainer>
            <Stack gap="lg">
                <PageHeader
                    title="Referral Links"
                    description="A link for a driver who sends you others. Whoever applies through it is assigned to you."
                    actions={(
                        <Button variant="primary" onClick={() => setCreating(true)} disabled={loading || !companyId}>
                            <Icon icon={Share2} />
                            Create link
                        </Button>
                    )}
                />

                <Notice tone="info" title="How it works" titleAs="h2">
                    <ol className="list-decimal space-y-ds-1 ps-ds-5">
                        <li>Create a link with the referring driver’s name.</li>
                        <li>Copy it and send it to them to share.</li>
                        <li>A driver who opens it fills in the full application or a one-minute interest form. You are notified and they are assigned to you.</li>
                    </ol>
                    {isAdmin
                        ? <p className="mt-ds-2">As a Company Admin you see every link in the company.</p>
                        : <p className="mt-ds-2">You see the links you made.</p>}
                </Notice>

                <Card padding="none">
                    <ReferralLinksTable
                        links={links}
                        counts={counts}
                        loading={loading}
                        onCopy={copy}
                        onDeactivate={askDeactivate}
                        error={error ? { message: error, onRetry: reload } : undefined}
                    />
                </Card>

                {creating && <CreateReferralLinkDialog onCreate={createLink} onClose={() => setCreating(false)} />}

                <ConfirmDialog
                    isOpen={Boolean(deactivating)}
                    title={`Switch off the link for ${deactivating?.referrerName || ''}?`}
                    description="Drivers who open it can still apply, but they are no longer assigned to you or counted as referred. A switched-off link cannot be switched on again; create a new one if you need it."
                    confirmLabel="Deactivate"
                    loading={deactivateState.busy}
                    error={deactivateState.error}
                    onConfirm={confirmDeactivate}
                    onCancel={() => setDeactivating(null)}
                />
            </Stack>
        </PageContainer>
    );
}

export default ReferralLinksPage;
