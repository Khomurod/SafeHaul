import React, { useCallback, useState } from 'react';
import { Icon, Info, Share2 } from '@design-system/icons';
import { ConfirmDialog } from '@design-system/patterns';
import { Button, Card } from '@/design-system/components';
import { PageContainer, PageHeader, Stack } from '@/design-system/layouts';
import { useData } from '@/context/DataContext';
import { isCompanyAdminForRoute } from '@app/auth/roles';
import { COMPANY_NAV_GROUPS } from '@app/routes/companyRouteManifest';
import { useToast } from '@shared/components/feedback/ToastProvider';
import { CreateReferralLinkDialog } from './CreateReferralLinkDialog';
import { ReferralLinksTable } from './ReferralLinksTable';
import { referralLinkUrl } from './referralLinksService';
import { useReferralLinks } from './useReferralLinks';

/** The sidebar group the page sits in, named above its title. */
const EYEBROW = COMPANY_NAV_GROUPS.applications.label;

/** How a referral link works, in the order it happens. */
const HOW_IT_WORKS = [
    'Create a link with the referring driver’s name.',
    'Copy it and send it to them to share.',
    'A driver who opens it fills in the full application or a one-minute interest form. You are notified and they are assigned to you.',
];

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
        <PageContainer width="standard">
            <Stack gap="lg">
                <PageHeader
                    eyebrow={EYEBROW}
                    title="Referral Links"
                    description="A link for a driver who sends you others. Whoever applies through it is assigned to you."
                    actions={(
                        <Button variant="primary" onClick={() => setCreating(true)} disabled={loading || !companyId}>
                            <Icon icon={Share2} />
                            Create link
                        </Button>
                    )}
                />

                <Card padding="none" elevation="soft" className="overflow-hidden">
                    <ReferralLinksTable
                        links={links}
                        counts={counts}
                        loading={loading}
                        onCopy={copy}
                        onDeactivate={askDeactivate}
                        error={error ? { message: error, onRetry: reload } : undefined}
                    />
                    {/* Whose links the list holds: the card's last row. */}
                    <p className="flex min-h-14 items-center border-t border-ds-table-divider px-ds-4 py-ds-3 text-ds-xs text-ds-content-muted">
                        {isAdmin ? 'As a Company Admin you see every link in the company.' : 'You see the links you made.'}
                    </p>
                </Card>

                {/* Under the links, so the links are the first thing on the page.
                    One band of three steps where each fits its words (1440px and
                    up); a list, one step under another, where three columns would
                    starve one of them. */}
                <Card as="section" padding="none" aria-labelledby="referral-links-how-it-works">
                    {/* Inset 16px at the sides, as the table's cells and its footer are, so the
                        page's cards share one inner edge. */}
                    <div className="px-ds-4 py-ds-5">
                        <h2 id="referral-links-how-it-works" className="flex items-center gap-ds-2 text-ds-heading-sm font-semibold text-ds-content">
                            <Icon icon={Info} className="text-ds-brand-primary" />
                            How it works
                        </h2>
                        <ol className="mt-ds-3 grid gap-ds-3 text-ds-body text-ds-content-secondary min-[1440px]:grid-cols-[auto_max-content_minmax(30rem,1fr)] min-[1440px]:gap-ds-8">
                            {HOW_IT_WORKS.map((step, index) => (
                                <li key={step} className="flex items-start gap-ds-3 [text-wrap:pretty]">
                                    {/* The numbered disc before a step a person reads, not operates:
                                        decoration, since the list numbers the steps. Feature-owned
                                        until the design system has its "Step indicator (read, not
                                        operated)" (roadmap §5, open). */}
                                    <span
                                        aria-hidden="true"
                                        className="flex h-ds-6 w-ds-6 shrink-0 items-center justify-center rounded-ds-full bg-ds-brand-primary-subtle text-ds-xs font-bold tabular-nums text-ds-brand-primary"
                                    >
                                        {index + 1}
                                    </span>
                                    <span>{step}</span>
                                </li>
                            ))}
                        </ol>
                    </div>
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
