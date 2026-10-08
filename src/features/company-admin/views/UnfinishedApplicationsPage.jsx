import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { Icon, Plus, RefreshCw } from '@design-system/icons';

import { isCompanyAdminForRoute } from '@app/auth/roles';
import { functions } from '@lib/firebase';
import { getE2EQueryParam, isE2ETestMode } from '@lib/runtime/e2eMode';
import { useData } from '@/context/DataContext';
import { Button, Card, FieldMessage, Notice } from '@/design-system/components';
import { PageContainer, PageHeader, Stack } from '@/design-system/layouts';
import { useInviteLink } from '../applicationPrep/useInviteLink';
import { useUnfinishedDraftDelete } from '../applicationPrep/useUnfinishedDraftDelete';
import { describeApplicant } from '../applicationPrep/unfinishedRowActions';
import UnfinishedDeleteDialog from '../applicationPrep/UnfinishedDeleteDialog';
import ApplicationPrepWorkspace from '../applicationPrep/ApplicationPrepWorkspace';
import UnfinishedApplicationReview from '../applicationPrep/UnfinishedApplicationReview';
import UnfinishedWorklistTable from '../applicationPrep/UnfinishedWorklistTable';
import UnfinishedWorklistToolbar from '../applicationPrep/UnfinishedWorklistToolbar';
import { countByFilter, visibleRows } from '../applicationPrep/unfinishedWorklist';
import { mockDrafts } from './unfinishedApplicationsMock';

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
 * To a recruiter, the answers, unless the carrier wrote them and the driver has
 * not yet touched them. *Open* appears only on the carrier's own rows, and what
 * comes back is the server's decision on every load, never this screen's. A
 * Company Admin may also open every application the driver has written to,
 * correct its answers (*Edit answers*), and delete any row with everything in it,
 * the same driver's other unfinished applications included — the owner's
 * decisions of 2026-10-06 and 2026-10-07, held by the server
 * (`getApplicationDraft`, `saveApplicationDraftEdits`, `purgeApplicationDraft`).
 * There is no Social Security Number to withhold — drafts never store one.
 *
 * Which action a row offers depends on its state, and that lives in
 * `unfinishedRowActions.js`; how far a row got, whether it has gone quiet, when
 * it will be removed and what the search and filters keep, in
 * `unfinishedWorklist.js`. Neither is decided here.
 */

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
    const { currentCompanyProfile, currentUserClaims } = useData();
    const companyId = currentCompanyProfile?.id;
    // The rule the sidebar and the admin routes use. The server checks again.
    const isCompanyAdmin = isCompanyAdminForRoute(currentUserClaims, companyId);
    // A company with no configured apply slug is still reachable by its id, so a
    // link is never unmintable for want of a slug.
    const appSlug = currentCompanyProfile?.appSlug || companyId;

    const isMock = isE2ETestMode && getE2EQueryParam('e2eUnfinished', '') === 'mock';

    const [drafts, setDrafts] = useState([]);
    const [retentionDays, setRetentionDays] = useState(30);
    /** The list stops at its 200 most recently active rows, and says so (`truncated`). */
    const [truncated, setTruncated] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    /** The instant the list was read, so every row's "3 days ago" is measured from one moment. */
    const [now, setNow] = useState(() => Date.now());
    const [filter, setFilter] = useState('all');
    const [query, setQuery] = useState('');
    const counts = useMemo(() => countByFilter(drafts, now), [drafts, now]);
    const shown = useMemo(() => visibleRows(drafts, { filter, query, now }), [drafts, filter, query, now]);
    // The wizard's page count depends on whether the company asks questions of its own.
    const hasCustomQuestions = (currentCompanyProfile?.customQuestions?.length || 0) > 0;

    /**
     * Which application the recruiter is working on, or null for the worklist.
     *
     * `key` is what mounts a fresh `ApplicationPrepWorkspace` per target, so one
     * driver's answers, documents and minted link cannot survive the move to
     * another. That used to be a `clearForNew` somebody had to remember to call.
     */
    const [prepTarget, setPrepTarget] = useState(null);
    /** The row a Company Admin is reading, or null. */
    const [reviewTarget, setReviewTarget] = useState(null);

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
            const at = Date.now();
            setNow(at);
            setDrafts(mockDrafts(at));
            setRetentionDays(30);
            setTruncated(false);
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
            setNow(Date.now());
            setDrafts(result.data?.drafts || []);
            setTruncated(result.data?.truncated === true);
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
             * What the mint changed server-side (`invite.js`), mirrored rather than
             * reloaded: `load()` swaps the table's body for a skeleton, which would
             * take the just-minted URL off the screen when it is needed. A link now
             * exists, so the row says when it went and reads "New link" (a press
             * would retire this one), its activity is today, and a prepared row is
             * sent.
             */
            const mintedAt = new Date().toISOString();
            setDrafts((rows) => rows.map((row) => (row.applicantKey !== key ? row : {
                ...row,
                invitedAt: mintedAt,
                updatedAt: mintedAt,
                ...(row.origin === 'company' && row.status === 'prepared' ? { status: 'sent' } : {}),
            })));
            // `copyUrl`, not `copy`: `copy` reads the hook's `link` state as it was
            // captured by THIS render, which is still null at this point. Minting
            // and copying in one press is what makes that difference visible.
            await copyUrl(url);
        } finally {
            setBusyKey(null);
        }
    }, [copyUrl, mint]);

    /**
     * What a deletion left behind: a sentence, focused because the row and its
     * Delete button are gone, and focus would otherwise fall to the page.
     */
    const [deletedNote, setDeletedNote] = useState(null);
    const deletedNoteRef = useRef(null);
    useEffect(() => { if (deletedNote) deletedNoteRef.current?.focus(); }, [deletedNote]);

    const onDeleted = useCallback(({ entry, deleted, skipped, alreadyGone }) => {
        const gone = new Set(deleted);
        setDrafts((rows) => rows.filter((row) => !gone.has(row.applicantKey)));
        const { actionName } = describeApplicant(entry);
        const others = deleted.filter((key) => key !== entry.applicantKey).length;
        setDeletedNote(alreadyGone
            ? `The application for ${actionName} was already gone. It may have been submitted, deleted or expired.`
            : `Deleted the unfinished application for ${actionName}${others > 0 ? ` and ${others} more` : ''}.`);
        // One of the driver's other applications changed since the dialog showed it,
        // and was kept: the list shows it as it is now.
        if (skipped.length > 0) load();
    }, [load]);
    const deletion = useUnfinishedDraftDelete({ companyId, onDeleted });
    // The hook's own stable callback, not `deletion`, which is a fresh object on
    // every render and would rebuild the table's columns with it.
    const { ask: askDeletion } = deletion;
    const askDelete = useCallback((entry) => {
        setDeletedNote(null);
        askDeletion(entry);
    }, [askDeletion]);

    const openRow = useCallback((entry, mode) => {
        setDeletedNote(null);
        if (mode === 'review') {
            setReviewTarget({ entry, editing: false });
            return;
        }
        setPrepTarget({ key: entry.applicantKey, applicantKey: entry.applicantKey });
    }, []);
    // The same read-only view, its editor opened as soon as it loads.
    const editRow = useCallback((entry) => {
        setDeletedNote(null);
        setReviewTarget({ entry, editing: true });
    }, []);

    const startNew = useCallback(() => {
        setDeletedNote(null);
        setPrepTarget({ key: 'new', applicantKey: null });
    }, []);

    // Back to the worklist, and reload it: a save may have created a row, changed a
    // name, or moved a status — and a row being read may have been submitted.
    const exitPrep = useCallback(() => { setPrepTarget(null); load(); }, [load]);
    const exitReview = useCallback(() => { setReviewTarget(null); load(); }, [load]);

    if (reviewTarget) {
        return (
            <UnfinishedApplicationReview
                key={reviewTarget.entry.applicantKey}
                companyId={companyId}
                entry={reviewTarget.entry}
                startEditing={reviewTarget.editing}
                onExit={exitReview}
            />
        );
    }

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
                    description={`Applications a driver or your team began and nobody has submitted yet. They are not in the applications pipeline: nothing has been signed and no consent given. Each is removed automatically after ${retentionDays} days without activity.`}
                />

                {/* Below the description rather than beside it: beside it, a tablet
                    squeezes the description into a column a few words wide. */}
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

                {deletedNote && (
                    <Notice ref={deletedNoteRef} tabIndex={-1} tone="success" announce="polite">
                        {deletedNote}
                    </Notice>
                )}

                {deletion.checkingKey && (
                    <Notice tone="info" announce="polite">Checking what will be deleted…</Notice>
                )}
                {deletion.checkError && (
                    <Notice tone="danger" announce="assertive">{deletion.checkError}</Notice>
                )}

                <Card padding="none" className="overflow-hidden">
                    <UnfinishedWorklistToolbar
                        counts={counts}
                        ready={!loading && !error}
                        truncated={truncated}
                        query={query}
                        onQuery={setQuery}
                        filter={filter}
                        onFilter={setFilter}
                    />
                    <UnfinishedWorklistTable
                        rows={shown}
                        loading={loading}
                        onOpen={openRow}
                        onEdit={editRow}
                        onDelete={askDelete}
                        isCompanyAdmin={isCompanyAdmin}
                        now={now}
                        retentionDays={retentionDays}
                        hasCustomQuestions={hasCustomQuestions}
                        empty={drafts.length > 0
                            ? { title: 'Nothing here matches.', description: 'Try another search, or another filter above.' }
                            : {
                                title: 'Nothing is unfinished.',
                                description: 'Everyone who has started an application has either submitted it or their draft has expired. Start one yourself when you have a driver’s paperwork in hand.',
                            }}
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
                    {!loading && drafts.length > 0 && (
                        <div className="flex flex-wrap justify-between gap-ds-2 border-t border-ds-border-subtle bg-ds-surface-subtle px-ds-4 py-ds-3 text-ds-sm text-ds-content-secondary">
                            {/* Spoken as it changes, so a search or a filter says what it kept. */}
                            <span aria-live="polite">
                                {truncated
                                    ? `Showing ${shown.length} of the ${drafts.length} most recently active`
                                    : `Showing ${shown.length} of ${drafts.length}`}
                            </span>
                            <span>Newest activity first</span>
                        </div>
                    )}
                </Card>

                <UnfinishedDeleteDialog deletion={deletion} />
            </Stack>
        </PageContainer>
    );
}

export default UnfinishedApplicationsPage;
