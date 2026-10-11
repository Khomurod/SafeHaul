import React, { useEffect, useId, useRef } from 'react';
import { Icon, Activity, Terminal, Wrench, DatabaseZap, CheckCircle, AlertCircle } from '@design-system/icons';
import { Badge, Button, Card } from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import { useSystemHealth } from '../hooks/useSystemHealth';
import { TelegramAlertsCard } from './alerts/TelegramAlertsCard';

/**
 * System Health — the hourly AI and blog watcher's alerts, and the one
 * maintenance action left: re-syncing every company's public profile.
 *
 * The Deep Diagnostic (it created test users and records in the live database
 * with a fixed password), "Sync Backend Structure" (it wrote schema defaults into
 * every live record missing a field) and the one-off SMS history backfill were
 * removed on 2026-10-11; `syncSystemStructure` refuses on the server.
 *
 * The action's explanation is visible help text, not a `title` tooltip, and its
 * outcome is an announced `Badge`. The output log is the approved inverse
 * surface, a named, keyboard-focusable `role="log"` region.
 */

/** Log severity → foreground token on the inverse console surface. */
const LOG_TONE_CLASS = {
    error: 'text-ds-status-danger-fg-on-inverse font-bold',
    success: 'text-ds-status-success-fg-on-inverse',
    warning: 'text-ds-status-warning-fg-on-inverse',
    info: 'text-ds-content-on-inverse',
};

export function SystemHealthView() {
    const { runBackfillProfiles, backfillStatus, logs } = useSystemHealth();

    const logsEndRef = useRef(null);
    const logRegionId = useId();

    // Auto-scroll logs
    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [logs]);

    return (
        <Stack gap="lg">
            <header>
                <h2 className="flex items-center gap-ds-2 text-ds-heading-lg font-bold text-ds-content">
                    {/* Standalone in an `<h2>`, so it is `2xl` — lucide rendered 24 bare. */}
                    <Icon icon={Activity} size="2xl" className="text-ds-content-link" /> System Health
                </h2>
                <p className="mt-1 text-ds-sm text-ds-content-secondary">
                    The hourly AI and blog watcher, and maintenance actions.
                </p>
            </header>

            {/* The hourly watcher of AI and the blog, and where it sends its alerts. */}
            <TelegramAlertsCard />

            <Card padding="md">
                <h3 className="mb-ds-4 flex items-center gap-ds-2 font-bold text-ds-content">
                    <Icon icon={Wrench} size="lg" /> Maintenance Actions
                </h3>
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
            </Card>

            <div className="flex h-[360px] max-h-[60vh] flex-col overflow-hidden rounded-ds-lg bg-ds-surface-inverse shadow-ds-lg">
                <div className="flex items-center gap-ds-2 border-b border-ds-border-inverse bg-ds-surface-inverse-subtle p-ds-3">
                    <Icon icon={Terminal} size="lg" className="text-ds-content-on-inverse-muted" />
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
                            Waiting for a maintenance action...
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
        </Stack>
    );
}

/**
 * One maintenance action: the button (label text frozen by the caller), the
 * explanation that used to live only in a `title` tooltip, and an announced
 * outcome. `error` previously changed nothing on screen.
 */
/*
 * `icon: Glyph`, not `icon: Icon`: the contract's component is called `Icon` and this file imports it, so
 * holding a glyph under that name would shadow it — and a token throws.
 */
function MaintenanceAction({ description, status, successLabel, onRun, icon: Glyph, label }) {
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
                    {!running && <Icon icon={Glyph} size="lg" />}
                    {label}
                </Button>
            </div>
        </div>
    );
}
