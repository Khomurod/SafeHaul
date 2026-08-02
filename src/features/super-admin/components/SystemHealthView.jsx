import React, { useEffect, useId, useRef, useState } from 'react';
import {
    Activity, Play, Pause, RotateCcw, Terminal, Server, Database, HardDrive, ShieldCheck,
    Wrench, RefreshCw, DatabaseZap, CheckCircle, AlertCircle, AlertTriangle, Clock
} from 'lucide-react';
import { Badge, Button, Card, ProgressBar, StatusMedallion } from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import { Modal } from '@shared/components/modals/Modal';
import { useSystemHealth } from '../hooks/useSystemHealth';

/**
 * System Health & Diagnostics — Super Admin infrastructure test runner and
 * maintenance console.
 *
 * Migrated to the design system 2026-07-28. Presentation only. `useSystemHealth`
 * is untouched: the 17-step `STEPS` list and its labels, the
 * `syncSystemStructure` / `backfillPublicProfiles` / `backfillAllSmsSentPhones`
 * callables, the localStorage resume contract, every log message and every
 * status value (`idle` | `running` | `paused` | `success` | `error`) are
 * unchanged. The reset guard still only asks when there is saved progress to
 * discard (i.e. not after a successful run), and its wording is preserved
 * verbatim.
 *
 * Defects fixed here:
 *  1. **Status was communicated by colour alone.** `getStatusColor()` returned a
 *     green/red/blue/orange/gray class trio and the only text was the raw status
 *     word inside it. Status is now a `Badge` carrying an icon *and* text, and
 *     the tone is a secondary signal.
 *  2. **Progress was a bare `<div>` whose width was the only signal** — no
 *     `role="progressbar"`, no `aria-valuenow`. Now the approved `ProgressBar`.
 *  3. **Blocking `window.confirm` on Reset** replaced with the shared accessible
 *     dialog. The "This will clear saved test progress. Continue?" wording is
 *     preserved as the dialog's description.
 *  4. **The three maintenance actions explained themselves only through a
 *     `title` attribute** — a tooltip is not an accessible description and is
 *     unreachable by touch. Each action now sits in a labelled row with visible
 *     help text, and the button keeps its exact label text.
 *  5. **Repair/backfill failures were silent in the UI** — `repairStatus`,
 *     `backfillStatus` and `smsBackfillStatus` had an `error` value that changed
 *     nothing on screen (only a line deep in the log). Each action now shows an
 *     announced outcome `Badge`.
 *  6. **The log console was an unnamed, unfocusable scroll region** with
 *     hand-picked `bg-gray-900` / `text-gray-*` colours, including an empty-state
 *     message at `text-gray-600` on `bg-gray-900` — **2.2:1**. It is now the
 *     approved inverse surface role (`--ds-color-surface-inverse` and friends,
 *     all pinned for contrast in the token tests), a `role="log"` region that is
 *     named and keyboard-focusable so it can be scrolled without a mouse.
 *  7. **Broken heading order** — the page title and the "Status" panel were both
 *     `<h2>` while "Control Center" was an `<h3>`. The view title is the single
 *     `<h2>` (the `<h1>` lives in the Super Admin masthead) and every panel
 *     heading is an `<h3>`.
 *  8. Legacy palette throughout, plus `bg-current` progress fill and hard-coded
 *     `shadow-md`/`shadow-lg`/`rounded-xl` values.
 */

/** Domain status → semantic tone/icon/label. The mapping is feature-owned. */
const STATUS_PRESENTATION = {
    idle: { tone: 'neutral', icon: Clock, label: 'Ready' },
    running: { tone: 'info', icon: RefreshCw, label: 'Running' },
    paused: { tone: 'warning', icon: Pause, label: 'Paused' },
    success: { tone: 'success', icon: CheckCircle, label: 'Success' },
    error: { tone: 'danger', icon: AlertCircle, label: 'Error' },
};

/** Log severity → foreground token on the inverse console surface. */
const LOG_TONE_CLASS = {
    error: 'text-ds-status-danger-fg-on-inverse font-bold',
    success: 'text-ds-status-success-fg-on-inverse',
    warning: 'text-ds-status-warning-fg-on-inverse',
    info: 'text-ds-content-on-inverse',
};

export function SystemHealthView() {
    const {
        runDiagnostics,
        pauseDiagnostics,
        resetDiagnostics,
        runSystemRepair,
        repairStatus,
        runBackfillProfiles,
        backfillStatus,
        runSmsBackfill,
        smsBackfillStatus,
        status,
        progress,
        logs,
        currentStep
    } = useSystemHealth();

    const logsEndRef = useRef(null);
    // Replaces the blocking `window.confirm` that guarded Reset.
    const [confirmingReset, setConfirmingReset] = useState(false);
    const logRegionId = useId();
    const progressLabelId = useId();

    // Auto-scroll logs
    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [logs]);

    const presentation = STATUS_PRESENTATION[status] || STATUS_PRESENTATION.idle;
    const StatusIcon = presentation.icon;

    // Reset only needs a guard when there is unfinished progress to discard. A
    // completed run had none before the migration either.
    const requestReset = () => {
        if (status === 'success') {
            resetDiagnostics();
            return;
        }
        setConfirmingReset(true);
    };

    return (
        <Stack gap="lg">
            <header>
                <h2 className="flex items-center gap-ds-2 text-ds-heading-lg font-bold text-ds-content">
                    <Activity className="text-ds-content-link" aria-hidden="true" /> System Health &amp; Diagnostics
                </h2>
                <p className="mt-1 text-ds-sm text-ds-content-secondary">
                    Deep inspection of Storage, Database, and Cloud Function integrity.
                </p>
            </header>

            {/* Maintenance actions. The explanatory copy was previously only a
                `title` tooltip on each button. */}
            <Card padding="md">
                <h3 className="mb-ds-4 flex items-center gap-ds-2 font-bold text-ds-content">
                    <Wrench size={18} aria-hidden="true" /> Maintenance Actions
                </h3>
                <Stack gap="md">
                    <MaintenanceAction
                        description="Force database structure to match Schema Config"
                        status={repairStatus}
                        successLabel="Structure synced"
                        onRun={runSystemRepair}
                        icon={Wrench}
                        label={repairStatus === 'running' ? 'Repairing...' : 'Sync Backend Structure'}
                    />
                    <MaintenanceAction
                        description="Force-sync all company data to public_profiles (fixes broken driver app links)"
                        status={backfillStatus}
                        successLabel="Profiles synced"
                        onRun={runBackfillProfiles}
                        icon={DatabaseZap}
                        label={
                            backfillStatus === 'running'
                                ? 'Syncing...'
                                : backfillStatus === 'success' ? 'Profiles Synced ✓' : 'Sync Public Profiles'
                        }
                    />
                    <MaintenanceAction
                        description="[TEMPORARY] Backfill SMS history for all companies — run once, then delete this button"
                        status={smsBackfillStatus}
                        successLabel="SMS history backfilled"
                        onRun={runSmsBackfill}
                        icon={DatabaseZap}
                        label={
                            smsBackfillStatus === 'running'
                                ? 'Backfilling SMS...'
                                : smsBackfillStatus === 'success' ? 'SMS Backfilled ✓' : 'Backfill SMS History'
                        }
                    />
                </Stack>
            </Card>

            {/* Main Diagnostic Panel */}
            <div className="grid grid-cols-1 gap-ds-6 lg:grid-cols-3">

                {/* Left: Controls & Status */}
                <div className="space-y-ds-6 lg:col-span-1">
                    <Card padding="md">
                        <h3 className="mb-ds-2 text-ds-sm font-bold uppercase tracking-wide text-ds-content-secondary">
                            Status
                        </h3>
                        <div className="mb-ds-4">
                            <Badge tone={presentation.tone} icon={StatusIcon}>{presentation.label}</Badge>
                        </div>

                        <span id={progressLabelId} className="sr-only">Diagnostic progress</span>
                        <ProgressBar
                            value={progress}
                            max={100}
                            labelledBy={progressLabelId}
                            valueText={`${progress}% complete — ${currentStep?.label || 'Waiting...'}`}
                            tone={presentation.tone === 'neutral' ? 'info' : presentation.tone}
                        />
                        <div className="mt-ds-2 flex flex-wrap justify-between gap-ds-2 text-ds-xs font-semibold text-ds-content-secondary">
                            <span>{progress}% Complete</span>
                            <span>{currentStep?.label || 'Waiting...'}</span>
                        </div>
                    </Card>

                    <Card padding="md">
                        <h3 className="mb-ds-4 flex items-center gap-ds-2 font-bold text-ds-content">
                            <ShieldCheck size={20} aria-hidden="true" /> Control Center
                        </h3>

                        <Stack gap="sm">
                            {status === 'running' ? (
                                <Button variant="secondary" size="lg" fullWidth onClick={pauseDiagnostics}>
                                    <Pause size={20} aria-hidden="true" /> Pause Test
                                </Button>
                            ) : status === 'paused' ? (
                                <Button variant="primary" size="lg" fullWidth onClick={() => runDiagnostics(true)}>
                                    <Play size={20} aria-hidden="true" /> Resume Test
                                </Button>
                            ) : (
                                <Button variant="primary" size="lg" fullWidth onClick={() => runDiagnostics(false)}>
                                    <Play size={20} aria-hidden="true" /> Start Deep Diagnostic
                                </Button>
                            )}

                            {(status === 'paused' || status === 'error' || status === 'success') && (
                                <Button variant="ghost" fullWidth onClick={requestReset}>
                                    <RotateCcw size={16} aria-hidden="true" /> Reset
                                </Button>
                            )}
                        </Stack>
                    </Card>

                    {/* Capability Badges */}
                    <div className="flex flex-wrap gap-ds-2">
                        <Badge tone="neutral" icon={HardDrive}>Storage</Badge>
                        <Badge tone="neutral" icon={Database}>Firestore</Badge>
                        <Badge tone="neutral" icon={Server}>Functions</Badge>
                        <Badge tone="neutral" icon={Activity}>Latency</Badge>
                    </div>
                </div>

                {/* Right: Terminal Logs */}
                <div className="lg:col-span-2">
                    <div className="flex h-[500px] max-h-[70vh] flex-col overflow-hidden rounded-ds-lg bg-ds-surface-inverse shadow-ds-lg">
                        <div className="flex items-center gap-ds-2 border-b border-ds-border-inverse bg-ds-surface-inverse-subtle p-ds-3">
                            <Terminal size={18} className="text-ds-content-on-inverse-muted" aria-hidden="true" />
                            <h3 id={logRegionId} className="font-mono text-ds-sm font-semibold text-ds-content-on-inverse">
                                System Output Log
                            </h3>
                        </div>

                        <div
                            role="log"
                            aria-labelledby={logRegionId}
                            tabIndex={0}
                            className="flex-1 space-y-ds-2 overflow-y-auto p-ds-4 font-mono text-ds-sm focus-visible:outline-none focus-visible:shadow-ds-focus"
                        >
                            {logs.length === 0 && (
                                <p className="mt-20 text-center text-ds-content-on-inverse-muted">
                                    Waiting for diagnostic or repair start...
                                </p>
                            )}
                            {logs.map((log) => (
                                <div key={log.id} className="flex gap-ds-3">
                                    <span className="shrink-0 text-ds-content-on-inverse-muted">
                                        {log.time.split('T')[1].split('.')[0]}
                                    </span>
                                    <span className={`break-all ${LOG_TONE_CLASS[log.type] || LOG_TONE_CLASS.info}`}>
                                        {log.message}
                                    </span>
                                </div>
                            ))}
                            <div ref={logsEndRef} />
                        </div>
                    </div>
                </div>

            </div>

            {confirmingReset && (
                <ResetConfirmDialog
                    onCancel={() => setConfirmingReset(false)}
                    onConfirm={() => {
                        setConfirmingReset(false);
                        resetDiagnostics();
                    }}
                />
            )}
        </Stack>
    );
}

/**
 * One maintenance action: the button (label text frozen by the caller), the
 * explanation that used to live only in a `title` tooltip, and an announced
 * outcome. `error` previously changed nothing on screen.
 */
function MaintenanceAction({ description, status, successLabel, onRun, icon: Icon, label }) {
    const descriptionId = useId();
    const running = status === 'running';

    return (
        <div className="flex flex-col gap-ds-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
                <p id={descriptionId} className="text-ds-sm text-ds-content-secondary">{description}</p>
                {/* Always in the DOM so the live region can announce into it. */}
                <p role="status" className="mt-1">
                    {status === 'success' && <Badge tone="success" icon={CheckCircle}>{successLabel}</Badge>}
                    {status === 'error' && <Badge tone="danger" icon={AlertCircle}>Failed — see the output log</Badge>}
                </p>
            </div>
            <div className="shrink-0">
                <Button
                    variant="primary"
                    onClick={onRun}
                    disabled={running}
                    loading={running}
                    aria-describedby={descriptionId}
                >
                    {!running && <Icon size={18} aria-hidden="true" />}
                    {label}
                </Button>
            </div>
        </div>
    );
}

/**
 * Replaces the blocking `window.confirm` that guarded Reset. The warning wording
 * is preserved verbatim.
 */
function ResetConfirmDialog({ onCancel, onConfirm }) {
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
                <StatusMedallion tone="warning" className="mx-auto mb-ds-3"><AlertTriangle /></StatusMedallion>
                <h2 id={titleId} className="text-ds-heading-sm font-bold text-ds-content">
                    Reset the diagnostic?
                </h2>
                <p id={descriptionId} className="mt-ds-3 text-ds-sm text-ds-content-secondary">
                    This will clear saved test progress. Continue?
                </p>
            </div>
            <div className="flex justify-end gap-ds-3 border-t border-ds-border-subtle bg-ds-surface-subtle p-ds-4">
                <Button variant="secondary" onClick={onCancel}>Cancel</Button>
                <Button variant="danger" onClick={onConfirm}>Reset</Button>
            </div>
        </Modal>
    );
}
