import React, { useEffect, useId, useRef, useState } from 'react';
import { Icon, Terminal, DatabaseZap, CheckCircle, AlertCircle } from '@design-system/icons';
import { Badge, Button, Card } from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import { ConfirmDialog } from '@design-system/patterns';
import { usePublicProfileSync } from '../hooks/usePublicProfileSync';
import { useFocusAfterRun } from '../hooks/useFocusAfterRun';

/**
 * Maintenance → Public profiles: Sync Public Profiles and its output log.
 *
 * `backfillPublicProfiles` rewrites every company's public profile — what its
 * driver application page reads — from the company record, whether or not it
 * is current. The hourly `reconcilePublicProfilesSchedule` keeps profiles
 * current by itself; this is the deliberate repair, so it asks before it runs.
 *
 * The action's explanation is visible help text, not a `title` tooltip, and its
 * outcome is an announced `Badge`. The output log is the approved inverse
 * surface, a named, keyboard-focusable `role="log"` region that scrolls itself
 * to its newest line without moving the page around it.
 */

/** Log severity → foreground token on the inverse console surface. */
const LOG_TONE_CLASS = {
    error: 'text-ds-status-danger-fg-on-inverse font-bold',
    success: 'text-ds-status-success-fg-on-inverse',
    warning: 'text-ds-status-warning-fg-on-inverse',
    info: 'text-ds-content-on-inverse',
};

export function PublicProfileSyncCard() {
    const { runBackfillProfiles, backfillStatus, logs } = usePublicProfileSync();
    const [confirming, setConfirming] = useState(false);
    const running = backfillStatus === 'running';
    const triggerRef = useRef(null);
    // Confirming disables the trigger while the sync runs; once it is over,
    // focus goes back to it.
    const focusAfterRun = useFocusAfterRun(running);
    const logRef = useRef(null);
    const logHeadingId = useId();

    // The newest line in view. The log scrolls itself: `scrollIntoView` would
    // scroll every ancestor too, and on this page that moved the whole screen.
    useEffect(() => {
        const log = logRef.current;
        if (log) log.scrollTop = log.scrollHeight;
    }, [logs]);

    const confirmSync = () => {
        setConfirming(false);
        focusAfterRun.current = triggerRef.current;
        runBackfillProfiles();
    };

    return (
        <Card padding="lg">
            <h3 className="mb-ds-2 text-ds-heading-sm font-semibold text-ds-content">Public profiles</h3>
            <Stack gap="lg">
                <MaintenanceAction
                    description="Force-sync all company data to public_profiles (fixes broken driver app links)"
                    status={backfillStatus}
                    successLabel="Profiles synced"
                    onRun={() => setConfirming(true)}
                    buttonRef={triggerRef}
                    icon={DatabaseZap}
                    label={
                        running
                            ? 'Syncing...'
                            : backfillStatus === 'success' ? 'Profiles Synced ✓' : 'Sync Public Profiles'
                    }
                />

                <div className="flex h-[360px] max-h-[60vh] flex-col overflow-hidden rounded-ds-lg bg-ds-surface-inverse shadow-ds-lg">
                    <div className="flex items-center gap-ds-2 border-b border-ds-border-inverse bg-ds-surface-inverse-subtle p-ds-3">
                        <Icon icon={Terminal} size="lg" className="text-ds-content-on-inverse-muted" />
                        <h4 id={logHeadingId} className="font-mono text-ds-sm font-semibold text-ds-content-on-inverse">
                            System Output Log
                        </h4>
                    </div>

                    <div
                        ref={logRef}
                        role="log"
                        aria-labelledby={logHeadingId}
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
                    </div>
                </div>
            </Stack>

            {confirming && (
                <ConfirmDialog
                    tone="warning"
                    title="Rewrite every public profile?"
                    description="This rewrites the public profile of every company — what its driver application page reads — from the company record, across the whole platform. The hourly check already keeps profiles current; run this to repair a broken application link."
                    confirmLabel="Sync public profiles"
                    onCancel={() => setConfirming(false)}
                    onConfirm={confirmSync}
                />
            )}
        </Card>
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
function MaintenanceAction({ description, status, successLabel, onRun, buttonRef, icon: Glyph, label }) {
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
                    ref={buttonRef}
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
