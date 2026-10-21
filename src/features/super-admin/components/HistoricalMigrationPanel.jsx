import React, { useCallback, useEffect, useRef, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { Icon, CheckCircle, History, Play, Search } from '@design-system/icons';
import { Badge, Button, Card, Notice, ProgressBar } from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import { ConfirmDialog } from '@design-system/patterns';

/**
 * TEMPORARY operator action: finish the historical application reconstruction.
 *
 * Applications submitted before records were preserved have no immutable
 * submission record and no official PDF. The backfill is a super-admin callable
 * run per company, and this panel, a card on the Maintenance page, is the
 * one-off surface for finishing it.
 *
 * WHY IT COUNTS INSTEAD OF BEING TOLD
 * -----------------------------------
 * The outstanding total is read from `surveyHistoricalReconstruction` when the
 * operator presses "Check what is left", and again after every run. No count is
 * written into this file. A hard-coded figure is a claim about production that
 * starts rotting the moment anyone submits an application, and an operator
 * reading a stale number has no way to tell — so the button's own label is
 * whatever the records currently say, even if that disagrees with what anyone
 * expected.
 *
 * WHY IT WAITS TO BE ASKED
 * ------------------------
 * The survey reads every application of every company and checks each preserved
 * record's PDF in Storage. Run on mount, it would run on every visit to the
 * page, the console's heaviest read, for a migration that ends.
 *
 * WHEN THE WORK IS DONE
 * ---------------------
 * Once the survey reports the work finished (nothing eligible, no record without
 * its PDF, nothing unreadable, no company unscanned), the panel says so in place
 * of the counts and the action. The survey counts the records independently of
 * the migration that wrote them, so it can contradict it. Both callables stay
 * deployed either way.
 *
 * If anything fails, the panel deliberately stays, shows exactly what is left,
 * and can be run again — the callable is create-only and idempotent, so a repeat
 * run adds what is missing and rewrites nothing.
 */

/** Nine minutes: the callable's own ceiling is 540s. */
const CALL_TIMEOUT_MS = 540000;

/** A migration pass cannot legitimately need more than this many resumes. */
const MAX_PASSES_PER_COMPANY = 25;

/** Ids are derived from applicant identity, so only a prefix is ever shown. */
const shortId = (id) => `${String(id).slice(0, 8)}…`;

const emptyTotals = () => ({ reconstructed: 0, pdfs: 0, failed: 0, skipped: 0, unsubmitted: 0 });

/** The panel's title and what the action is for, the same in every state. */
function PanelHeading() {
    return (
        <div className="flex flex-wrap items-start justify-between gap-ds-3">
            <div>
                <h3 className="mb-ds-2 flex items-center gap-ds-2 text-ds-heading-sm font-semibold text-ds-content">
                    <Icon icon={History} size="lg" />
                    Historical application records
                </h3>
                <p className="max-w-prose text-ds-sm text-ds-content-secondary">
                    Applications submitted before records were preserved have no immutable
                    submission record and no official PDF. This one-off action gives them one,
                    built only from evidence that survives and clearly marked as reconstructed.
                    Unfinished drafts and already-preserved records are left untouched.
                </p>
            </div>
            <Badge tone="warning">Temporary</Badge>
        </div>
    );
}

export function HistoricalMigrationPanel() {
    const [survey, setSurvey] = useState(null);
    const [phase, setPhase] = useState('unchecked');
    const [error, setError] = useState('');
    const [confirming, setConfirming] = useState(false);
    const [progress, setProgress] = useState([]);
    const [runTotals, setRunTotals] = useState(emptyTotals());

    // Guards against a survey that resolves after this panel has unmounted; set on
    // every mount, or StrictMode's rehearsal unmount leaves it false for good.
    const activeRef = useRef(true);
    useEffect(() => {
        activeRef.current = true;
        return () => { activeRef.current = false; };
    }, []);

    const runSurvey = useCallback(async ({ includePdfCheck = true } = {}) => {
        const surveyFn = httpsCallable(functions, 'surveyHistoricalReconstruction', {
            timeout: CALL_TIMEOUT_MS,
        });
        const response = await surveyFn({ includePdfCheck });
        return response.data;
    }, []);

    // The count, read when the operator asks. Until it answers, nothing is
    // claimed either way.
    const check = async () => {
        setError('');
        setPhase('surveying');
        try {
            const data = await runSurvey();
            if (!activeRef.current) return;
            setSurvey(data);
            setPhase(data.complete ? 'complete' : 'idle');
        } catch (err) {
            if (!activeRef.current) return;
            // A survey that failed is not evidence the work is done, so the
            // panel stays, says why, and offers the check again.
            setError(err?.message || 'Could not read the historical record counts.');
            setPhase('unchecked');
        }
    };

    const migrate = async () => {
        setConfirming(false);
        setError('');
        setPhase('running');
        setRunTotals(emptyTotals());

        // A company needs a pass if it has applications to reconstruct OR a
        // preserved record whose PDF is missing — the run repairs those from the
        // stored snapshot while it walks the company, so skipping it would leave
        // the document missing permanently.
        const targets = (survey?.companies || []).filter(
            (company) => company.remaining > 0 || company.missingPdfs > 0,
        );
        setProgress(targets.map((company) => ({
            companyId: company.companyId,
            companyName: company.companyName,
            expected: company.remaining,
            expectedPdfs: company.missingPdfs || 0,
            state: 'waiting',
            ...emptyTotals(),
            failedIds: [],
        })));

        const reconstructFn = httpsCallable(functions, 'reconstructHistoricalApplications', {
            timeout: CALL_TIMEOUT_MS,
        });

        const overall = emptyTotals();

        for (const company of targets) {
            setProgress((rows) => rows.map((row) => (
                row.companyId === company.companyId ? { ...row, state: 'running' } : row
            )));

            const tally = { ...emptyTotals(), failedIds: [] };
            let cursor = null;
            let passes = 0;
            let companyError = '';

            try {
                for (;;) {
                    passes += 1;
                    const response = await reconstructFn({
                        companyId: company.companyId,
                        ...(cursor ? { startAfterApplicationId: cursor } : {}),
                    });
                    const result = response.data || {};

                    for (const key of Object.keys(emptyTotals())) {
                        tally[key] += result[key] || 0;
                    }
                    for (const failure of result.errors || []) {
                        tally.failedIds.push(shortId(failure.applicationId));
                    }

                    if (!result.truncated) break;
                    cursor = result.lastApplicationId;
                    if (passes >= MAX_PASSES_PER_COMPANY) {
                        companyError = 'Stopped after too many resume passes.';
                        break;
                    }
                }
            } catch (err) {
                companyError = err?.message || 'The migration call failed.';
            }

            for (const key of Object.keys(overall)) overall[key] += tally[key];

            if (!activeRef.current) return;
            setProgress((rows) => rows.map((row) => (
                row.companyId === company.companyId
                    ? { ...row, ...tally, passes, state: companyError ? 'error' : 'done', companyError }
                    : row
            )));
            setRunTotals({ ...overall });
        }

        // Independent verification. The run's own report is not the answer.
        setPhase('verifying');
        try {
            const verified = await runSurvey();
            if (!activeRef.current) return;
            setSurvey(verified);
            setPhase(verified.complete ? 'complete' : 'incomplete');
        } catch (err) {
            if (!activeRef.current) return;
            setError(
                `${err?.message || 'Verification failed.'} `
                + 'The migration ran, but completion could not be confirmed, so this panel stays.',
            );
            setPhase('incomplete');
        }
    };

    // Verified complete: there is nothing to offer, and the panel says so.
    if (phase === 'complete') {
        return (
            <Card padding="lg">
                <Stack gap="lg">
                    <PanelHeading />
                    <Notice announce="polite" tone="success" title="Nothing is left to do" titleAs="h4">
                        <p>
                            Counted from the stored records just now: every submitted application
                            has its preserved record and its official PDF.
                        </p>
                    </Notice>
                </Stack>
            </Card>
        );
    }

    if (phase === 'unchecked' || phase === 'surveying') {
        const surveying = phase === 'surveying';
        return (
            <Card padding="lg" className="border-ds-status-warning-border">
                <Stack gap="lg">
                    <PanelHeading />
                    <p role="status" className="sr-only">
                        {surveying ? 'Checking whether any historical applications still need a preserved record.' : ''}
                    </p>
                    {error && (
                        <Notice announce="assertive" tone="danger" title="Something went wrong" titleAs="h4">
                            {error}
                        </Notice>
                    )}
                    <div>
                        <Button variant="secondary" onClick={check} disabled={surveying} loading={surveying}>
                            {!surveying && <Icon icon={Search} />}
                            {surveying ? 'Checking…' : 'Check what is left'}
                        </Button>
                    </div>
                </Stack>
            </Card>
        );
    }

    const totals = survey?.totals;
    const remaining = totals?.remaining ?? null;
    const missingPdfs = totals?.missingPdfs ?? 0;
    const unreadable = totals?.unreadable ?? 0;
    const outstanding = (remaining ?? 0) + missingPdfs;
    const busy = phase === 'running' || phase === 'verifying';
    const doneCount = progress.filter((row) => row.state === 'done' || row.state === 'error').length;

    return (
        <Card padding="lg" className="border-ds-status-warning-border">
            <Stack gap="lg">
                <PanelHeading />

                {/* A multi-minute action must never be silent. */}
                <p role="status" className="sr-only">
                    {phase === 'running'
                        ? `Migration running. ${doneCount} of ${progress.length} companies processed.`
                        : phase === 'verifying'
                            ? 'Migration finished. Verifying the result against the stored records.'
                            : ''}
                </p>

                {totals && (
                    <dl className="grid grid-cols-2 gap-ds-3 sm:grid-cols-4">
                        {[
                            ['Still eligible', remaining, 'text-ds-content'],
                            ['Missing official PDFs', missingPdfs, 'text-ds-content'],
                            ['Already preserved', totals.preserved, 'text-ds-content-secondary'],
                            ['Drafts left alone', totals.neverSubmitted, 'text-ds-content-secondary'],
                        ].map(([label, value, tone]) => (
                            <div key={label} className="rounded-ds-md border border-ds-border-subtle p-ds-3">
                                <dt className="text-ds-xs text-ds-content-secondary">{label}</dt>
                                <dd className={`text-ds-heading-sm font-semibold tabular-nums ${tone}`}>{value}</dd>
                            </div>
                        ))}
                    </dl>
                )}

                {/* The count is measured, never assumed — so say so. */}
                {totals && (
                    <p className="text-ds-xs text-ds-content-secondary">
                        Counted from the stored records just now, across{' '}
                        {totals.companiesWithApplications} companies with applications
                        {survey?.pdfCheckPerformed ? ' (official PDFs checked)' : ' (PDFs not checked)'}.
                    </p>
                )}

                {unreadable > 0 && (
                    <Notice
                        announce="assertive"
                        tone="warning"
                        title={`${unreadable} application${unreadable === 1 ? '' : 's'} could not be read`}
                        titleAs="h4"
                    >
                        <p>
                            These need a person to look at them. They are never treated as drafts,
                            because that would hide a broken record behind a harmless count.
                            {' '}
                            {(survey?.companies || [])
                                .filter((company) => company.unreadableApplicationIds?.length)
                                .map((company) => `${company.companyName}: ${company.unreadableApplicationIds.map(shortId).join(', ')}`)
                                .join(' · ')}
                        </p>
                    </Notice>
                )}

                {error && (
                    <Notice announce="assertive" tone="danger" title="Something went wrong" titleAs="h4">
                        {error}
                    </Notice>
                )}

                {progress.length > 0 && (
                    <div>
                        <h4 className="mb-ds-2 text-ds-sm font-semibold text-ds-content">Progress by company</h4>
                        {busy && (
                            <ProgressBar
                                value={doneCount}
                                max={progress.length}
                                label={`${doneCount} of ${progress.length} companies processed`}
                                className="mb-ds-3"
                            />
                        )}
                        <ul className="space-y-ds-2">
                            {progress.map((row) => (
                                <li
                                    key={row.companyId}
                                    className="flex flex-wrap items-center justify-between gap-ds-3 rounded-ds-md border border-ds-border-subtle p-ds-3 text-ds-sm"
                                >
                                    <span className="font-medium text-ds-content">{row.companyName}</span>
                                    <span className="flex flex-wrap items-center gap-ds-3 tabular-nums text-ds-content-secondary">
                                        <span>
                                            {row.expected > 0
                                                ? `${row.expected} expected`
                                                : `${row.expectedPdfs} PDF${row.expectedPdfs === 1 ? '' : 's'} to repair`}
                                        </span>
                                        <span>{row.reconstructed} reconstructed</span>
                                        <span>{row.pdfs} PDFs</span>
                                        {row.failed > 0 && (
                                            <Badge tone="danger">{row.failed} failed</Badge>
                                        )}
                                        {row.state === 'waiting' && <Badge tone="neutral">Waiting</Badge>}
                                        {row.state === 'running' && <Badge tone="info">Running</Badge>}
                                        {row.state === 'done' && row.failed === 0 && (
                                            <Badge tone="success">Done</Badge>
                                        )}
                                        {row.state === 'error' && <Badge tone="danger">Error</Badge>}
                                    </span>
                                    {row.companyError && (
                                        <span className="w-full text-ds-xs text-ds-status-danger-fg">{row.companyError}</span>
                                    )}
                                    {row.failedIds.length > 0 && (
                                        <span className="w-full break-words text-ds-xs text-ds-content-secondary">
                                            Could not rebuild: {row.failedIds.join(', ')}
                                        </span>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {phase === 'incomplete' && (
                    <Notice announce="polite" tone="warning" title="Work still remains" titleAs="h4">
                        <p>
                                    {runTotals.reconstructed} record{runTotals.reconstructed === 1 ? '' : 's'} and{' '}
                                    {runTotals.pdfs} PDF{runTotals.pdfs === 1 ? '' : 's'} were written.{' '}
                                    {remaining} application{remaining === 1 ? '' : 's'} still eligible
                                    {missingPdfs > 0 ? `, and ${missingPdfs} preserved record${missingPdfs === 1 ? '' : 's'} still without a PDF` : ''}.
                                    Nothing was overwritten, and running again is safe — it adds only what
                            is missing. This panel stays until the count reaches zero.
                        </p>
                    </Notice>
                )}

                <div className="flex flex-wrap items-center gap-ds-3">
                    <Button
                        variant="primary"
                        onClick={() => setConfirming(true)}
                        disabled={busy || outstanding === 0}
                        loading={busy}
                    >
                        {!busy && <Icon icon={Play} />}
                        {phase === 'verifying'
                            ? 'Verifying…'
                            : phase === 'running'
                                ? 'Migrating…'
                                // With nothing eligible but a PDF missing, the run's
                                // real work is the repair, so say that instead of
                                // offering to migrate zero applications.
                                : remaining === 0 && missingPdfs > 0
                                    ? `Repair ${missingPdfs} missing PDF${missingPdfs === 1 ? '' : 's'}`
                                    : `Migrate the remaining ${remaining ?? 0}`}
                    </Button>
                    {outstanding === 0 && (
                        <span className="flex items-center gap-ds-2 text-ds-sm text-ds-content-secondary">
                            <Icon icon={CheckCircle} />
                            Nothing eligible remains; resolve the items above to retire this panel.
                        </span>
                    )}
                </div>
            </Stack>

            {confirming && (
                <MigrateConfirmDialog
                    remaining={remaining}
                    missingPdfs={missingPdfs}
                    companies={(survey?.companies || []).filter(
                        (company) => company.remaining > 0 || company.missingPdfs > 0,
                    )}
                    onCancel={() => setConfirming(false)}
                    onConfirm={migrate}
                />
            )}
        </Card>
    );
}

/**
 * Confirmation before the writing run.
 *
 * It states the three things an operator needs to weigh: how many records will be
 * created, that records are permanent once written, and what will deliberately
 * not be touched.
 */
function MigrateConfirmDialog({ remaining, missingPdfs = 0, companies, onCancel, onConfirm }) {
    const repairOnly = remaining === 0 && missingPdfs > 0;

    return (
        <ConfirmDialog
            /*
             * The approved pattern, whose tone map decides the confirm variant
             * once: `warning` pairs with a danger-styled confirm, which is the
             * right pairing for an action that writes permanent, immutable records
             * across every company.
             */
            tone="warning"
            title={repairOnly
                ? `Rebuild ${missingPdfs} missing official PDF${missingPdfs === 1 ? '' : 's'}?`
                : `Create preserved records for ${remaining} application${remaining === 1 ? '' : 's'}?`}
            description={(
                <>
                    {repairOnly
                        ? 'This rebuilds each missing document from the record that is already '
                          + 'stored — never from a fresh read of the application — across '
                        : 'This writes a permanent, immutable submission record and an official PDF for '
                          + 'each one, across '}
                    {companies.length} compan{companies.length === 1 ? 'y' : 'ies'}.
                    Records are create-only: once written they cannot be edited or replaced.
                </>
            )}
            confirmLabel={repairOnly
                ? `Rebuild ${missingPdfs} PDF${missingPdfs === 1 ? '' : 's'}`
                : `Migrate ${remaining} application${remaining === 1 ? '' : 's'}`}
            onCancel={onCancel}
            onConfirm={onConfirm}
        >
            <div className="space-y-ds-3 text-ds-sm text-ds-content-secondary">
                <ul className="list-disc space-y-1 pl-5">
                    <li>Unfinished drafts and outreach leads are left completely untouched.</li>
                    <li>Applications that already have a record keep it, and their PDF is not rewritten.</li>
                    <li>
                        Nothing is invented. Missing dates, signatures and agreement wording are
                        recorded as unavailable, and no Clearinghouse consent is ever claimed.
                    </li>
                    <li>Every record is marked as reconstructed wherever it appears.</li>
                </ul>
                <p>It may take several minutes. You can run it again safely if it stops early.</p>
            </div>
        </ConfirmDialog>
    );
}

export default HistoricalMigrationPanel;
