import React, { useCallback, useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { Icon, Plus, RefreshCw } from '@design-system/icons';

import { functions } from '@lib/firebase';
import { getE2EQueryParam, isE2ETestMode } from '@lib/runtime/e2eMode';
import { useData } from '@/context/DataContext';
import { Button, Card, FieldMessage } from '@/design-system/components';
import { PageContainer, PageHeader, Stack } from '@/design-system/layouts';
import { useInviteLink } from '../applicationPrep/useInviteLink';
import ApplicationPrepWorkspace from '../applicationPrep/ApplicationPrepWorkspace';
import UnfinishedWorklistTable from '../applicationPrep/UnfinishedWorklistTable';

/**
 * One workspace for every application that has been started and not submitted.
 *
 * ## Why this screen exists
 *
 * Answers are saved from the applicant's first Next rather than only at
 * submission, which stops a driver losing their work — but on its own that only
 * helps an applicant who happens to come back. This is the other half: a carrier
 * watching people drop off at the licence page finally has somebody to call, and
 * a recruiter with a driver's paperwork in hand can start the application for
 * them.
 *
 * ## Why it used to be two screens, and why it is one now
 *
 * *Started (unfinished)* listed every unfinished draft; *Start an application* was
 * a task screen that had grown a second list of its own, scoped to what the
 * carrier had prepared. Because `listApplicationDrafts` filters by nothing, a
 * carrier-prepared draft was returned by both — so the same application appeared
 * on two screens with different columns and different actions, and a recruiter had
 * to know which page answered which question.
 *
 * That split was never a security boundary. Both callables return contact and
 * progress; **neither has ever returned an answer.** The read rule lives in one
 * place — `companyMayReadAnswers`, enforced by `getCompanyPreparedDraft`, which
 * also refuses outright any draft the carrier did not author — and it is unchanged
 * by who lists what. So the two screens became one place, and the merge changed no
 * permission.
 *
 * The separation that *is* a rule is still here: an unfinished application stays
 * out of the applications pipeline. Nothing has been signed, no consent has been
 * given, no snapshot exists and no confirmation number was issued. Putting these
 * in the ATS funnel would mean statuses, assignment and exports treating a
 * half-typed form as a candidate record the applicant never agreed to file.
 *
 * ## What it deliberately does not show
 *
 * The answers, unless the carrier wrote them and the driver has not yet touched
 * them. *Open* appears only on the carrier's own rows, and what comes back is the
 * server's decision on every load, never this screen's. There is no Social
 * Security Number to withhold — drafts never store one.
 *
 * Which action a row offers depends on its state, and that lives in
 * `unfinishedRowActions.js` rather than here.
 */

/*
 * Fixture rows for the `?e2eUnfinished=mock` harness, gated on
 * `VITE_E2E_TEST_MODE`, which a production build never sets.
 *
 * It exists because this screen is in the blocking pixel lane and its content
 * came from a real `listApplicationDrafts` callable. With no credentials the call
 * fails, and *how* it fails decides what renders — so the committed baseline was a
 * loading skeleton in one environment and CI captured something 30% different. A
 * screenshot of a screen whose content depends on a network failure is not a
 * baseline.
 *
 * The rows are one per state the worklist can show — both origins, all four
 * statuses — plus the two shapes that used to break the old table: a draft with no
 * name typed yet, and one with no contact details at all. Timestamps are fixed and
 * sit before the lane's frozen clock.
 */
const MOCK_DRAFTS = Object.freeze([
    Object.freeze({
        applicantKey: 'aaaa1111bbbb2222cccc',
        origin: 'driver',
        status: 'in_progress',
        firstName: 'Dana',
        lastName: 'Whitfield',
        email: 'dana.whitfield@example.test',
        phone: '(555) 010-2233',
        lastSemanticStep: 'license',
        lastStep: 2,
        updatedAt: '2026-06-14T16:45:00.000Z',
    }),
    Object.freeze({
        applicantKey: 'dddd3333eeee4444ffff',
        origin: 'company',
        status: 'driver_in_progress',
        firstName: 'Priya',
        lastName: 'Raman',
        email: 'priya.raman@example.test',
        phone: '(555) 010-8890',
        lastSemanticStep: 'employment',
        lastStep: 5,
        preparedBy: { uid: 'u-1', name: 'Rae Recruiter' },
        lockedEmployerCount: 2,
        updatedAt: '2026-06-13T11:20:00.000Z',
    }),
    Object.freeze({
        applicantKey: 'bbbb5555cccc6666dddd',
        origin: 'driver',
        status: 'in_progress',
        email: 'starter@example.test',
        lastSemanticStep: 'contact',
        lastStep: 0,
        updatedAt: '2026-06-12T09:05:00.000Z',
    }),
    Object.freeze({
        applicantKey: 'eeee7777ffff8888aaaa',
        origin: 'company',
        status: 'sent',
        firstName: 'Marcus',
        lastName: 'Iyer',
        email: 'marcus.iyer@example.test',
        phone: '(555) 010-4417',
        lastSemanticStep: 'contact',
        lastStep: 0,
        preparedBy: { uid: 'u-1', name: 'Rae Recruiter' },
        lockedEmployerCount: 1,
        updatedAt: '2026-06-10T14:02:00.000Z',
    }),
    Object.freeze({
        applicantKey: 'cccc9999dddd0000eeee',
        origin: 'company',
        status: 'prepared',
        firstName: 'Tomas',
        lastName: 'Okafor',
        email: 'tomas.okafor@example.test',
        phone: '(555) 010-7712',
        lastSemanticStep: null,
        lastStep: 0,
        preparedBy: { uid: 'u-2', name: 'Sam Sourcer' },
        updatedAt: '2026-06-09T21:30:00.000Z',
    }),
]);

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
    // A company with no configured apply slug is still reachable by its id, so a
    // link is never unmintable for want of a slug.
    const appSlug = currentCompanyProfile?.appSlug || companyId;

    const isMock = isE2ETestMode && getE2EQueryParam('e2eUnfinished', '') === 'mock';

    const [drafts, setDrafts] = useState([]);
    const [retentionDays, setRetentionDays] = useState(30);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    /**
     * Which application the recruiter is working on, or null for the worklist.
     *
     * `key` is what mounts a fresh `ApplicationPrepWorkspace` per target, so one
     * driver's answers, documents and minted link cannot survive the move to
     * another. That used to be a `clearForNew` somebody had to remember to call.
     */
    const [prepTarget, setPrepTarget] = useState(null);

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
    const { mint, copyUrl, linkFor, copied, copyFailed, error: mintError } = invite;

    /**
     * Which row is minting, and which row's mint failed.
     *
     * The hook's own `busy` and `error` are single values for a whole table, so
     * reading them unscoped would spin every button and print one row's failure
     * under every driver.
     */
    const [busyKey, setBusyKey] = useState(null);
    const [failedKey, setFailedKey] = useState(null);

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
            // One call, one row per document. There is no second list to union
            // against and therefore no way to show a draft twice — see
            // `functions/drafts/list.js`.
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
     * Mint, then copy.
     *
     * The raw token exists exactly once — the callable returns it and never can
     * again — so it is minted at the moment somebody asks for it rather than for
     * every row on load. A refused clipboard is not a lost link: the hook records
     * it and the row says so, with the URL selectable beside it. A refused MINT is
     * a lost link, and the row says that too.
     */
    const createLink = useCallback(async (entry) => {
        const key = entry.applicantKey;
        setBusyKey(key);
        setFailedKey(null);
        try {
            const url = await mint(key);
            if (!url) {
                setFailedKey(key);
                return;
            }
            /**
             * The row said "Not sent yet"; a link now exists, so it does not.
             *
             * Patched locally rather than reloaded, because `load()` sets `loading`
             * and the table swaps its body for a skeleton — which would take the
             * just-minted URL off the screen at the exact moment the recruiter
             * needs to copy it. This is not optimism either: minting is precisely
             * what moves a `prepared` draft to `sent` server-side, and it moves
             * nothing else, which is why only that one transition is mirrored.
             */
            setDrafts((rows) => rows.map((row) => (
                row.applicantKey === key && row.origin === 'company' && row.status === 'prepared'
                    ? { ...row, status: 'sent' }
                    : row
            )));
            // `copyUrl`, not `copy`: `copy` reads the hook's `link` state as it was
            // captured by THIS render, which is still null at this point. Minting
            // and copying in one press is what makes that difference visible.
            await copyUrl(url);
        } finally {
            setBusyKey(null);
        }
    }, [copyUrl, mint]);

    const openPrepared = useCallback((entry) => {
        setPrepTarget({ key: entry.applicantKey, applicantKey: entry.applicantKey });
    }, []);

    const startNew = useCallback(() => setPrepTarget({ key: 'new', applicantKey: null }), []);

    // Back to the worklist, and reload it: a save may have created a row, changed a
    // name, or moved a status.
    const exitPrep = useCallback(() => { setPrepTarget(null); load(); }, [load]);

    if (prepTarget) {
        return (
            <ApplicationPrepWorkspace
                key={prepTarget.key}
                companyId={companyId}
                appSlug={appSlug}
                openKey={prepTarget.applicantKey}
                onExit={exitPrep}
            />
        );
    }

    return (
        <PageContainer>
            <Stack gap="lg">
                <PageHeader
                    title="Unfinished applications"
                    description={`Applications somebody began and has not submitted — whether a driver started one or you did. They are not in the applications pipeline: nothing has been signed and no consent has been given. Kept for ${retentionDays} days, then removed automatically.`}
                />

                <div className="flex flex-wrap gap-ds-2">
                    <Button variant="primary" onClick={startNew} disabled={!companyId}>
                        <Icon icon={Plus} size="sm" /> Start an application
                    </Button>
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

                <UnfinishedWorklistTable
                    rows={drafts}
                    loading={loading}
                    onOpen={openPrepared}
                    link={{
                        linkFor,
                        busyKey,
                        copied,
                        copyFailed,
                        error: mintError,
                        failedKey,
                        onCreate: createLink,
                        onCopy: copyUrl,
                    }}
                />
            </Stack>
        </PageContainer>
    );
}

export default UnfinishedApplicationsPage;
