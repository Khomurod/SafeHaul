import React, { useId, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { Play, CheckCircle, AlertCircle, AlertTriangle } from 'lucide-react';
import { Button, Card, FormField, Input, StatusMedallion } from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import { Modal } from '@shared/components/modals/Modal';

/**
 * Performance-stats backfill maintenance panel.
 *
 * Migrated to the design system 2026-07-28. Presentation only — the
 * `backfillCompanyStats` and `backfillAllStats` callable names, their
 * `{ timeout: 540000 }` option, the `{ companyId, dryRun }` and `{ dryRun }`
 * payloads, the `companyId.trim()` transformation, the "Please enter a Company
 * ID" guard, the result field precedence and every frozen string are unchanged.
 *
 * Defects fixed here:
 *  1. **"Run All Companies" had no confirmation at all**, while the
 *     single-company action at least required an explicit ID. It rewrites
 *     `stats_daily` for *every* company on the platform and takes up to nine
 *     minutes. It is now behind an accessible confirmation dialog. The
 *     dry-run variants stay unguarded, because they are explicitly
 *     non-mutating — the dialog only gates the writing runs.
 *  2. Neither the error nor the result was announced, so a screen-reader user
 *     got no feedback at all from a nine-minute maintenance action. Both are
 *     now live regions, and the in-flight state is announced too.
 *  3. Every button was disabled by a shared `loading` flag but nothing said a
 *     run was in progress — silent progress on a long action.
 *  4. Legacy palette throughout, including a `bg-amber-50` warning panel and a
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
    const [confirmingRunAll, setConfirmingRunAll] = useState(false);
    const companyFieldId = useId();

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

    const runAllBackfill = async (dryRun) => {
        setConfirmingRunAll(false);
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
                    <h2 className="mb-ds-2 text-ds-heading-sm font-semibold text-ds-content">
                        Performance Stats Backfill
                    </h2>
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
                    <h3 className="mb-ds-3 font-semibold text-ds-content">
                        Single Company Backfill
                    </h3>
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
                            {!loading && <Play size={16} aria-hidden="true" />}
                            Dry-Run (Preview)
                        </Button>
                        <Button
                            variant="primary"
                            tone="success"
                            onClick={() => runBackfill(companyId, false)}
                            disabled={loading || !companyId.trim()}
                            loading={loading}
                        >
                            {!loading && <CheckCircle size={16} aria-hidden="true" />}
                            Run Actual Backfill
                        </Button>
                    </div>
                </Card>

                {/* All Companies Section */}
                <Card padding="md" className="border-ds-status-warning-border bg-ds-status-warning-bg">
                    <h3 className="mb-ds-3 font-semibold text-ds-content">
                        All Companies
                    </h3>
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
                            {!loading && <Play size={16} aria-hidden="true" />}
                            Dry-Run All
                        </Button>
                        <Button
                            variant="danger"
                            onClick={() => setConfirmingRunAll(true)}
                            disabled={loading}
                            loading={loading}
                        >
                            {!loading && <CheckCircle size={16} aria-hidden="true" />}
                            Run All Companies
                        </Button>
                    </div>
                </Card>

                {/* Results Display */}
                {error && (
                    <Card padding="md" role="alert" className="flex items-start gap-ds-3 border-ds-status-danger-border bg-ds-status-danger-bg">
                        <AlertCircle size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-ds-status-danger-fg" />
                        <div>
                            <h4 className="mb-1 font-semibold text-ds-status-danger-fg">Error</h4>
                            <p className="break-words text-ds-sm text-ds-status-danger-fg">{error}</p>
                        </div>
                    </Card>
                )}

                {result && (
                    <Card padding="md" role="status" className="border-ds-status-success-border bg-ds-status-success-bg">
                        <div className="mb-ds-4 flex items-start gap-ds-3">
                            <CheckCircle size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-ds-status-success-fg" />
                            <div>
                                <h4 className="mb-1 font-semibold text-ds-status-success-fg">
                                    {result.dryRun ? 'Dry-Run Complete' : 'Backfill Complete'}
                                </h4>
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
                                <h5 className="mb-ds-2 text-ds-sm font-semibold text-ds-content">
                                    Preview (First {result.preview.length} Days)
                                </h5>
                                <div className="max-h-64 overflow-auto rounded-ds-lg border border-ds-border-subtle bg-ds-surface">
                                    <table className="w-full text-ds-sm">
                                        <caption className="sr-only">Backfill preview by day</caption>
                                        <thead className="sticky top-0 bg-ds-surface-subtle">
                                            <tr>
                                                <th scope="col" className="px-ds-3 py-ds-2 text-left text-ds-xs font-semibold text-ds-content-secondary">Date</th>
                                                <th scope="col" className="px-ds-3 py-ds-2 text-right text-ds-xs font-semibold text-ds-content-secondary">Dials</th>
                                                <th scope="col" className="px-ds-3 py-ds-2 text-right text-ds-xs font-semibold text-ds-content-secondary">Connected</th>
                                                <th scope="col" className="px-ds-3 py-ds-2 text-right text-ds-xs font-semibold text-ds-content-secondary">Users</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-ds-border-subtle">
                                            {result.preview.map((day, idx) => (
                                                <tr key={idx} className="hover:bg-ds-surface-subtle">
                                                    <th scope="row" className="px-ds-3 py-ds-2 text-left font-mono text-ds-xs font-normal text-ds-content">{day.dateKey}</th>
                                                    <td className="px-ds-3 py-ds-2 text-right font-semibold tabular-nums text-ds-content">{day.totalDials}</td>
                                                    <td className="px-ds-3 py-ds-2 text-right tabular-nums text-ds-status-success-fg">{day.connected}</td>
                                                    <td className="px-ds-3 py-ds-2 text-right tabular-nums text-ds-content-secondary">{day.userCount}</td>
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

            {confirmingRunAll && (
                <RunAllConfirmDialog
                    onCancel={() => setConfirmingRunAll(false)}
                    onConfirm={() => runAllBackfill(false)}
                />
            )}
        </Card>
    );
}

/**
 * Confirmation for the platform-wide writing backfill. There was previously no
 * guard of any kind on this action.
 */
function RunAllConfirmDialog({ onCancel, onConfirm }) {
    const titleId = useId();
    const descriptionId = useId();

    return (
        <Modal
            onClose={onCancel}
            labelledBy={titleId}
            describedBy={descriptionId}
            closeOnBackdrop={false}
            className="w-full max-w-lg overflow-hidden rounded-ds-xl border border-ds-border-subtle bg-ds-surface shadow-ds-lg"
        >
            <div className="p-ds-5 text-center">
                <StatusMedallion tone="danger" className="mx-auto mb-ds-3"><AlertTriangle /></StatusMedallion>
                <h2 id={titleId} className="text-ds-heading-sm font-bold text-ds-content">
                    Run the backfill for every company?
                </h2>
                <p id={descriptionId} className="mt-ds-3 text-ds-sm text-ds-content-secondary">
                    This writes <code>stats_daily</code> for every company on the platform, overwriting
                    existing figures. It can take up to nine minutes and cannot be undone. Run the
                    dry-run first if you have not already.
                </p>
            </div>
            <div className="flex justify-end gap-ds-3 border-t border-ds-border-subtle bg-ds-surface-subtle p-ds-4">
                <Button variant="secondary" onClick={onCancel}>Cancel</Button>
                <Button variant="danger" onClick={onConfirm}>Run for all companies</Button>
            </div>
        </Modal>
    );
}
