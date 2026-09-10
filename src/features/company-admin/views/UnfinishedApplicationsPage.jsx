import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { Icon, Copy, Link2, RefreshCw } from '@design-system/icons';

import { functions } from '@lib/firebase';
import { getE2EQueryParam, isE2ETestMode } from '@lib/runtime/e2eMode';
import { useData } from '@/context/DataContext';
import { Badge, Button, Card, DataTable, FieldMessage } from '@/design-system/components';
import { PageContainer, PageHeader, Stack } from '@/design-system/layouts';
import { useInviteLink } from '../applicationPrep/useInviteLink';

/**
 * Applications somebody started and did not finish.
 *
 * ## Why this screen exists
 *
 * Answers are now saved from the applicant's first Next rather than only at
 * submission, which stops a driver losing their work — but on its own that only
 * helps an applicant who happens to come back. This is the other half: a carrier
 * watching people drop off at the licence page finally has somebody to call.
 *
 * ## Why it is not the applications list
 *
 * These are deliberately kept out of the ATS funnel. An unfinished application is
 * not a submitted one: nothing has been signed, no consent has been given, no
 * snapshot exists and no confirmation number was issued. Putting them in the
 * pipeline would mean statuses, assignment and exports treating a half-typed form
 * as a candidate record — and the applicant never agreed to file it.
 *
 * ## What it deliberately does not show
 *
 * The answers. This is a contact list: a name, a way to reach them, how far they
 * got and when. Reading someone's partial DOT questionnaire before they have
 * agreed to submit it is a decision they have not made, so the server does not
 * send it and this screen could not display it. There is no Social Security
 * Number to withhold — drafts never store one.
 *
 * ## What it can now DO, and why that is not a hole in the rule above
 *
 * Until 2026-09-09 this screen had exactly one control — Refresh. A recruiter
 * looking at somebody who stopped at the licence page could call them, and that
 * was the whole of it: there was no way to send them back to their own work,
 * because `mintApplicationInvite` refused any draft the carrier had not itself
 * prepared. So the answer to "how do I get this driver to finish?" was "ask them
 * to start again", which throws away everything the draft feature exists to keep.
 *
 * **Copy continuation link** mints one and copies it. It changes nothing about
 * what this screen may read: the link is a *pointer*, and
 * `exchangeApplicationInvite` hands over a draft's answers only while the carrier
 * itself authored them — which for a driver-started application is never. Whoever
 * opens this link is asked to confirm their last name, date of birth, Social
 * Security Number and a contact detail already on the record before anything is
 * returned, and a recruiter cannot pass that check. Minting is rate-limited per
 * company and caller, and every regeneration retires the previous link.
 */

/*
 * Fixture drafts for the `?e2eUnfinished=mock` harness, following the same shape
 * as `ReviewChangePortal`'s: gated on `VITE_E2E_TEST_MODE`, which a production
 * build never sets.
 *
 * It exists because this screen is in the blocking pixel lane and its content
 * came from a real `listApplicationDrafts` callable. With no credentials the call
 * fails, and *how* it fails decides what renders — so the committed baseline was
 * a loading skeleton in one environment and CI captured something 30% different.
 * A screenshot of a screen whose content depends on a network failure is not a
 * baseline.
 *
 * The three rows are the cases worth seeing: a complete contact, a draft with no
 * name typed yet, and one with no contact details at all. Timestamps are fixed
 * and sit before the lane's frozen clock.
 */
const MOCK_DRAFTS = Object.freeze([
    Object.freeze({
        id: 'draft-1',
        firstName: 'Dana',
        lastName: 'Whitfield',
        email: 'dana.whitfield@example.test',
        phone: '(555) 010-2233',
        lastSemanticStep: 'license',
        updatedAt: '2026-06-14T16:45:00.000Z',
    }),
    Object.freeze({
        id: 'draft-2',
        email: 'starter@example.test',
        lastSemanticStep: 'contact',
        updatedAt: '2026-06-12T09:05:00.000Z',
    }),
    Object.freeze({
        id: 'draft-3',
        firstName: 'Marcus',
        lastName: 'Iyer',
        lastSemanticStep: 'employment',
        updatedAt: '2026-06-09T21:30:00.000Z',
    }),
]);

/** The wizard's own step names, in order, so "how far did they get" reads plainly. */
const STEP_LABELS = Object.freeze({
    contact: 'Personal information',
    qualifications: 'Qualifications',
    license: 'License & credentials',
    violations: 'Driving record',
    accidents: 'Accident history',
    employment: 'Employment history',
    general: 'General questions',
    custom_questions: 'Company questions',
    review: 'Review',
    consent: 'Agreements & signature',
});

function describeStep(entry) {
    if (entry.lastSemanticStep && STEP_LABELS[entry.lastSemanticStep]) {
        return STEP_LABELS[entry.lastSemanticStep];
    }
    return `Step ${(entry.lastStep || 0) + 1}`;
}

function describeError(error, fallback) {
    switch (error?.code) {
        case 'functions/unauthenticated':
            return 'Your session has ended. Sign in again to continue.';
        case 'functions/permission-denied':
            return 'You do not have access to this company.';
        default:
            return fallback;
    }
}

export function UnfinishedApplicationsPage() {
    const { currentCompanyProfile } = useData();
    const companyId = currentCompanyProfile?.id;
    // The same fallback `StartApplicationPage` uses: a company with no configured
    // apply slug is still reachable by its id, so a link is never unmintable for
    // want of a slug.
    const appSlug = currentCompanyProfile?.appSlug || companyId;

    const isMock = isE2ETestMode && getE2EQueryParam('e2eUnfinished', '') === 'mock';

    const [drafts, setDrafts] = useState([]);
    const [retentionDays, setRetentionDays] = useState(30);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    /**
     * The continuation link, and which row it belongs to.
     *
     * `linkFor` rather than `link`, and that is structural rather than tidiness:
     * the hook holds one link at a time and does not watch which row asked for it,
     * so a plain read would leave the previous driver's URL sitting under the next
     * driver's Copy button. One press away from sending a stranger somebody else's
     * application.
     */
    const invite = useInviteLink({ companyId, appSlug });

    const load = useCallback(async () => {
        if (isMock) {
            setDrafts(MOCK_DRAFTS);
            setRetentionDays(30);
            setError(null);
            setLoading(false);
            return;
        }
        if (!companyId) return;
        setLoading(true);
        setError(null);
        try {
            const call = httpsCallable(functions, 'listApplicationDrafts');
            const result = await call({ companyId });
            setDrafts(result.data?.drafts || []);
            if (result.data?.retentionDays) setRetentionDays(result.data.retentionDays);
        } catch (loadError) {
            setError(describeError(loadError, 'Unfinished applications could not be loaded.'));
            setDrafts([]);
        } finally {
            setLoading(false);
        }
    }, [companyId, isMock]);

    useEffect(() => { load(); }, [load]);

    /**
     * Which row is minting. The hook's own `busy` is not enough: it is a single
     * flag for a table, so reading it would spin every button on the screen.
     */
    const [busyKey, setBusyKey] = useState(null);

    /**
     * Which row's mint failed, so the hook's single error can be shown on it.
     *
     * The same shape as `linkFor` and for the same reason: the hook holds one
     * error at a time and does not watch which row asked. Rendering it unscoped
     * would put "your session has ended" under every driver on the screen.
     */
    const [failedKey, setFailedKey] = useState(null);

    /**
     * Mint, then copy.
     *
     * The raw token exists exactly once — the callable returns it and never can
     * again — so it is minted at the moment somebody asks for it rather than for
     * every row on load. A refused clipboard is not a lost link: the hook records
     * it and the row says so, with the URL selectable beside it.
     *
     * A refused MINT is a lost link, and until review found it on 2026-09-09 that
     * was the one failure nobody said anything about: `useInviteLink` set its
     * `error`, this screen never read it, so an expired session or a spent rate
     * limit stopped the button spinning and produced nothing — no link, no
     * message. The same silent shape as the clipboard defect this hook already
     * records, one step earlier again.
     */
    const { mint, copy, copyUrl, linkFor, copied, copyFailed, error: mintError } = invite;
    const mintFor = useCallback(async (applicantKey) => {
        setBusyKey(applicantKey);
        setFailedKey(null);
        try {
            const url = await mint(applicantKey);
            if (!url) {
                setFailedKey(applicantKey);
                return;
            }
            // `copyUrl`, not `copy`: `copy` reads the hook's `link` state as it was
            // captured by THIS render, which is still null at this point. Minting
            // and copying in one press is what makes that difference visible.
            await copyUrl(url);
        } finally {
            setBusyKey(null);
        }
    }, [mint, copyUrl]);

    const columns = useMemo(() => [
        {
            key: 'name',
            header: 'Applicant',
            rowHeader: true,
            priority: 'primary',
            width: 'lg',
            render: (entry) => {
                const name = [entry.firstName, entry.lastName].filter(Boolean).join(' ');
                return (
                    <span className="font-medium text-ds-content">
                        {name || 'Name not entered yet'}
                    </span>
                );
            },
        },
        {
            key: 'contact',
            header: 'Contact',
            priority: 'secondary',
            width: 'lg',
            render: (entry) => (
                <div className="flex flex-col gap-ds-1 text-ds-sm text-ds-content-secondary">
                    {entry.email && <span>{entry.email}</span>}
                    {entry.phone && <span>{entry.phone}</span>}
                    {!entry.email && !entry.phone && <span>No contact details yet</span>}
                </div>
            ),
        },
        {
            key: 'progress',
            header: 'Reached',
            priority: 'secondary',
            width: 'md',
            render: (entry) => <Badge tone="info">{describeStep(entry)}</Badge>,
        },
        {
            key: 'updated',
            header: 'Last activity',
            priority: 'tertiary',
            width: 'md',
            render: (entry) => (
                <span className="text-ds-sm text-ds-content-secondary">
                    {entry.updatedAt ? new Date(entry.updatedAt).toLocaleString() : 'Unknown'}
                </span>
            ),
        },
        {
            key: 'continue',
            header: 'Continue',
            priority: 'secondary',
            width: 'lg',
            render: (entry) => {
                const minted = linkFor(entry.applicantKey);
                const name = [entry.firstName, entry.lastName].filter(Boolean).join(' ')
                    || entry.email || entry.phone || 'this applicant';
                return (
                    <div className="flex flex-col items-start gap-ds-2">
                        <Button
                            variant={minted ? 'primary' : 'secondary'}
                            size="sm"
                            loading={busyKey === entry.applicantKey}
                            /* Record-specific, because a table of identical
                               "Copy link" buttons tells a screen-reader user
                               nothing about which row they are on. */
                            aria-label={minted
                                ? `Copy the continuation link for ${name}`
                                : `Create a continuation link for ${name}`}
                            onClick={() => (minted ? copy() : mintFor(entry.applicantKey))}
                        >
                            <Icon icon={minted ? Copy : Link2} size="sm" />
                            {minted ? (copied ? 'Copied' : 'Copy link') : 'Copy continuation link'}
                        </Button>
                        {minted && (
                            <>
                                <code className="block max-w-full overflow-x-auto rounded-ds-md border border-ds-border-subtle bg-ds-surface-subtle p-ds-2 text-ds-xs text-ds-content">
                                    {minted.url}
                                </code>
                                <p className="text-ds-xs text-ds-content-muted">
                                    Works for {minted.expiresInDays} days and is shown once. It asks them to
                                    confirm who they are, so it will not show you their answers.
                                </p>
                            </>
                        )}
                        {copyFailed && minted && (
                            <FieldMessage tone="error">
                                Your browser would not let us copy it. Select the link above and copy it yourself.
                            </FieldMessage>
                        )}
                        {mintError && failedKey === entry.applicantKey && (
                            <FieldMessage tone="error">{mintError}</FieldMessage>
                        )}
                    </div>
                );
            },
        },
        // The pieces read above, not the hook's return object — that is a fresh
        // literal on every render, which would make this `useMemo` a no-op.
    ], [linkFor, copy, copied, copyFailed, busyKey, mintFor, mintError, failedKey]);

    return (
        <PageContainer>
            <Stack gap="lg">
                <PageHeader
                    title="Started (unfinished)"
                    description={`Applications somebody began and has not submitted. They are not in the applications pipeline: nothing has been signed and no consent has been given. Kept for ${retentionDays} days, then removed automatically.`}
                />

                <div className="flex flex-wrap gap-ds-2">
                    <Button variant="secondary" onClick={load} disabled={loading}>
                        <Icon icon={RefreshCw} size="sm" /> Refresh
                    </Button>
                </div>

                {error && (
                    <Card padding="md">
                        <FieldMessage tone="error">{error}</FieldMessage>
                        <div className="mt-ds-2">
                            <Button variant="secondary" onClick={load}>
                                <Icon icon={RefreshCw} size="sm" /> Try again
                            </Button>
                        </div>
                    </Card>
                )}

                <DataTable
                    ariaLabel="Unfinished applications"
                    density="compact"
                    minWidth="md"
                    data={drafts}
                    columns={columns}
                    isLoading={loading}
                    loadingLabel="Loading unfinished applications"
                    empty={{
                        title: 'No unfinished applications.',
                        description: 'Everyone who has started an application has either submitted it or their draft has expired.',
                    }}
                />
            </Stack>
        </PageContainer>
    );
}

export default UnfinishedApplicationsPage;
