import React, { useEffect, useId, useRef, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { Icon, Play, CheckCircle } from '@design-system/icons';
import { Button, Card, FormField, Input, Notice } from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import { ConfirmDialog } from '@design-system/patterns';

/**
 * Performance-stats backfill, a card on the Maintenance page.
 *
 * Presentation only. Frozen contracts: the `backfillCompanyStats` and
 * `backfillAllStats` callable names, their `{ timeout: 540000 }` option, the
 * `{ companyId, dryRun }` and `{ dryRun }` payloads, the `companyId.trim()`
 * transformation, the "Please enter a Company ID" guard, the result field
 * precedence and every frozen string.
 *
 * Defects fixed here:
 *  1. **Neither writing run asked first.** "Run All Companies" rewrites
 *     `stats_daily` for *every* company on the platform and "Run Actual
 *     Backfill" overwrites one company's, each taking up to nine minutes. Both
 *     are now behind an accessible confirmation dialog, and once a confirmed
 *     run ends focus goes back to the button that started it (confirming
 *     disables it, so the dialog's own hand-back cannot). The dry-run variants
 *     stay unguarded, because they are explicitly non-mutating — the dialogs
 *     only gate the writing runs.
 *  2. Neither the error nor the result was announced, so a screen-reader user
 *     got no feedback at all from a nine-minute maintenance action. Both are
 *     now live regions, and the in-flight state is announced too.
 *  3. Every button was disabled by a shared `loading` flag but nothing said a
 *     run was in progress — silent progress on a long action.
 *  4. Legacy palette throughout, including a `bg-ds-status-warning-bg` warning panel and a
 *     `bg-red-600` run button.
 *
 * PRODUCT/LEGAL — deliberately NOT changed: the "All Companies" help text names
 * a specific real customer ("Only run after verifying Ray Star LLC results.").
 * Naming a customer in production operator copy is a product/legal decision, and
 * the repository establishes no generic replacement wording, so the string is
 * preserved verbatim and recorded in the roadmap for an owner to decide.
 */
export default function StatsBackfillPanel() {
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState('');
    // CALL-12 FIX: Replace hardcoded test company ID with an input field.
    // Having a hardcoded company ID in production code risks running a backfill
    // against the wrong company (data corruption) and exposes internal IDs.
    const [companyId, setCompanyId] = useState('');
    // Which writing run is waiting for its confirmation: 'company', 'all' or null.
    const [confirming, setConfirming] = useState(null);
    const companyFieldId = useId();
    const companyRunRef = useRef(null);
    const allRunRef = useRef(null);
    // The button that started the confirmed run in flight.
    const focusAfterRun = useRef(null);

    // Confirming disables every run button, so the dialog's own focus hand-back
    // lands on <body>. Once the run is over, focus goes back to the button that
    // started it — unless the operator has since put it somewhere else.
    useEffect(() => {
        if (loading || !focusAfterRun.current) return;
        const trigger = focusAfterRun.current;
        focusAfterRun.current = null;
        if (!document.activeElement || document.activeElement === document.body) trigger.focus();
    }, [loading]);

    const runBackfill = async (targetCompanyId, dryRun) => {
        if (!targetCompanyId.trim()) {
            setError('Please enter a Company ID');
            return;
        }
        setLoading(true);
        setError('');
        setResult(null);

        try {
            // Set 9-minute timeout for large data processing
            const backfillFn = httpsCallable(functions, 'backfillCompanyStats', {
                timeout: 540000 // 9 minutes
            });
            const response = await backfillFn({ companyId: targetCompanyId.trim(), dryRun });
            setResult(response.data);
        } catch (err) {
            console.error('Backfill error:', err);
            setError(err.message || 'Failed to run backfill');
        } finally {
            setLoading(false);
        }
    };

    const confirmCompanyRun = () => {
        setConfirming(null);
        focusAfterRun.current = companyRunRef.current;
        return runBackfill(companyId, false);
    };

    const runAllBackfill = async (dryRun) => {
        setConfirming(null);
        if (!dryRun) focusAfterRun.current = allRunRef.current;
        setLoading(true);
        setError('');
        setResult(null);

        try {
            // Set 9-minute timeout for processing all companies
            const backfillFn = httpsCallable(functions, 'backfillAllStats', {
                timeout: 540000 // 9 minutes
            });
            const response = await backfillFn({ dryRun });
            setResult(response.data);
        } catch (err) {
            console.error('Backfill All error:', err);
            setError(err.message || 'Failed to run backfill');
        } finally {
            setLoading(false);
        }
    };

    const summaryRows = result ? [
        result.companyId && ['Company ID:', result.companyId, 'font-mono text-ds-content'],
        result.companiesProcessed && ['Companies Processed:', result.companiesProcessed, 'font-semibold text-ds-content'],
        result.companiesSucceeded && ['Companies Succeeded:', result.companiesSucceeded, 'font-semibold text-ds-status-success-fg'],
        ['Total Activities Processed:', result.totalActivitiesProcessed?.toLocaleString() || 0, 'font-semibold text-ds-content-link'],
        result.legacyCount !== undefined && ['↳ Legacy (activities):', result.legacyCount.toLocaleString(), 'text-ds-content-secondary'],
        result.modernCount !== undefined && ['↳ Modern (activity_logs):', result.modernCount.toLocaleString(), 'text-ds-content-secondary'],
        result.daysWithStats && ['Days with Stats:', result.daysWithStats, 'font-semibold text-ds-content'],
        result.daysWritten && ['Days Written:', result.daysWritten, 'font-semibold text-ds-status-success-fg'],
    ].filter(Boolean) : [];

    return (
        <Card padding="lg">
            <Stack gap="lg">
                <div>
                    <h3 className="mb-ds-2 text-ds-heading-sm font-semibold text-ds-content">
                        Performance Stats Backfill
                    </h3>
                    <p className="text-ds-sm text-ds-content-secondary">
                        Rebuild stats_daily from all historical activity data. Use dry-run first to preview results.
                    </p>
                </div>

                {/* A nine-minute action must not be silent. */}
                <p role="status" className="sr-only">
                    {loading ? 'Backfill running. This can take several minutes.' : ''}
                </p>

                {/* Single Company Section */}
                <Card padding="md" className="border-ds-status-info-border">
                    <h4 className="mb-ds-3 font-semibold text-ds-content">
                        Single Company Backfill
                    </h4>
                    <FormField
                        id={companyFieldId}
                        label="Company ID"
                        description="Find this in the Firebase Console → Firestore → companies → [document ID]"
                    >
                        <Input
                            id={companyFieldId}
                            type="text"
                            value={companyId}
                            onChange={e => setCompanyId(e.target.value)}
                            placeholder="Enter Firestore company document ID..."
                            className="font-mono"
                        />
                    </FormField>
                    <div className="mt-ds-4 flex flex-wrap gap-ds-3">
                        <Button
                            variant="primary"
                            onClick={() => runBackfill(companyId, true)}
                            disabled={loading || !companyId.trim()}
                            loading={loading}
                        >
                            {!loading && <Icon icon={Play} />}
                            Dry-Run (Preview)
                        </Button>
                        <Button
                            ref={companyRunRef}
                            variant="primary"
                            tone="success"
                            onClick={() => setConfirming('company')}
                            disabled={loading || !companyId.trim()}
                            loading={loading}
                        >
                            {!loading && <Icon icon={CheckCircle} />}
                            Run Actual Backfill
                        </Button>
                    </div>
                </Card>

                {/* All Companies Section */}
                <Card padding="md" className="border-ds-status-warning-border bg-ds-status-warning-bg">
                    <h4 className="mb-ds-3 font-semibold text-ds-content">
                        All Companies
                    </h4>
                    <p className="mb-ds-4 text-ds-sm text-ds-content-secondary">
                        ⚠️ This will process all companies. Only run after verifying Ray Star LLC results.
                    </p>
                    <div className="flex flex-wrap gap-ds-3">
                        <Button
                            variant="secondary"
                            onClick={() => runAllBackfill(true)}
                            disabled={loading}
                            loading={loading}
                        >
                            {!loading && <Icon icon={Play} />}
                            Dry-Run All
                        </Button>
                        <Button
                            ref={allRunRef}
                            variant="danger"
                            onClick={() => setConfirming('all')}
                            disabled={loading}
                            loading={loading}
                        >
                            {!loading && <Icon icon={CheckCircle} />}
                            Run All Companies
                        </Button>
                    </div>
                </Card>

                {/* Results Display */}
                {error && (
                    <Notice announce="assertive" tone="danger" title="Error" titleAs="h5">
                        {error}
                    </Notice>
                )}

                {/* NOT a `Notice`, and the audit had this one wrong. It is a
                    RESULTS PANEL: the heading and sentence are followed by a
                    nested summary card and a preview table. `Notice` owns a
                    tinted block carrying a message; a card carrying other
                    structure stays a card. */}
                {result && (
                    <Card padding="md" role="status" className="border-ds-status-success-border bg-ds-status-success-bg">
                        <div className="mb-ds-4 flex items-start gap-ds-3">
                            <Icon icon={CheckCircle} size="xl" className="mt-0.5 shrink-0 text-ds-status-success-fg" />
                            <div>
                                <h5 className="mb-1 font-semibold text-ds-status-success-fg">
                                    {result.dryRun ? 'Dry-Run Complete' : 'Backfill Complete'}
                                </h5>
                                <p className="text-ds-sm text-ds-status-success-fg">
                                    {result.dryRun
                                        ? 'Preview generated successfully. No data was modified.'
                                        : 'Stats have been written to Firestore.'}
                                </p>
                            </div>
                        </div>

                        <Card padding="md" className="bg-ds-surface">
                            <dl className="space-y-ds-2">
                                {summaryRows.map(([label, value, valueClass]) => (
                                    <div key={label} className="flex justify-between gap-ds-4 text-ds-sm">
                                        <dt className="text-ds-content-secondary">{label}</dt>
                                        <dd className={`tabular-nums ${valueClass}`}>{value}</dd>
                                    </div>
                                ))}
                            </dl>
                        </Card>

                        {/* Preview Data */}
                        {result.preview && result.preview.length > 0 && (
                            <div className="mt-ds-4">
                                <h6 className="mb-ds-2 text-ds-sm font-semibold text-ds-content">
                                    Preview (First {result.preview.length} Days)
                                </h6>
                                <div
                                    role="region"
                                    aria-label="Backfill preview by day. Scroll to view all rows and columns."
                                    tabIndex={0}
                                    className="max-h-64 overflow-auto rounded-ds-lg border border-ds-border-subtle bg-ds-surface focus-visible:outline-none focus-visible:shadow-ds-focus"
                                >
                                    <table className="ds-native-table" data-density="compact" data-pin-first-column>
                                        <caption className="sr-only">Backfill preview by day</caption>
                                        <thead className="sticky top-0 bg-ds-table-header-bg">
                                            <tr>
                                                <th scope="col" className="font-semibold">Date</th>
                                                <th scope="col" className="text-right font-semibold">Dials</th>
                                                <th scope="col" className="text-right font-semibold">Connected</th>
                                                <th scope="col" className="text-right font-semibold">Users</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {result.preview.map((day, idx) => (
                                                <tr key={idx}>
                                                    <th scope="row" className="font-mono font-normal text-ds-content">{day.dateKey}</th>
                                                    <td className="text-right font-semibold tabular-nums text-ds-content">{day.totalDials}</td>
                                                    <td className="text-right tabular-nums text-ds-status-success-fg">{day.connected}</td>
                                                    <td className="text-right tabular-nums">{day.userCount}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </Card>
                )}
            </Stack>

            {confirming === 'company' && (
                <RunCompanyConfirmDialog
                    companyId={companyId.trim()}
                    onCancel={() => setConfirming(null)}
                    onConfirm={confirmCompanyRun}
                />
            )}

            {confirming === 'all' && (
                <RunAllConfirmDialog
                    onCancel={() => setConfirming(null)}
                    onConfirm={() => runAllBackfill(false)}
                />
            )}
        </Card>
    );
}

/**
 * Confirmation for one company's writing backfill, which used to run on the
 * click: it overwrites that company's `stats_daily`, day by day, with figures
 * rebuilt from its call history.
 */
function RunCompanyConfirmDialog({ companyId, onCancel, onConfirm }) {
    return (
        <ConfirmDialog
            tone="danger"
            title="Run the backfill for this company?"
            description={(
                <>
                    This writes <code>stats_daily</code> for company <code>{companyId}</code>,
                    overwriting each day&rsquo;s existing figures with ones rebuilt from its call
                    history. It can take up to nine minutes and cannot be undone. Run the dry-run
                    first if you have not already.
                </>
            )}
            confirmLabel="Run for this company"
            onCancel={onCancel}
            onConfirm={onConfirm}
        />
    );
}

/**
 * Confirmation for the platform-wide writing backfill. There was previously no
 * guard of any kind on this action.
 */
/**
 * The approved `ConfirmDialog`: initial focus on Cancel rather than on a
 * nine-minute irreversible write, and a synchronous guard against a double
 * activation of that write.
 */
function RunAllConfirmDialog({ onCancel, onConfirm }) {
    return (
        <ConfirmDialog
            tone="danger"
            title="Run the backfill for every company?"
            description={(
                <>
                    This writes <code>stats_daily</code> for every company on the platform, overwriting
                    existing figures. It can take up to nine minutes and cannot be undone. Run the
                    dry-run first if you have not already.
                </>
            )}
            confirmLabel="Run for all companies"
            onCancel={onCancel}
            onConfirm={onConfirm}
        />
    );
}
