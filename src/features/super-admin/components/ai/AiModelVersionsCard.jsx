/**
 * Which versions of each AI service SafeHaul uses, for photos and for text,
 * and what the daily check last found (`functions/ops/modelRefresh.js`).
 *
 * The card owns its state, unlike the diagnostics cards beside it: it loads its
 * own table and is the only place that changes it. The two actions that can
 * change what the router uses, "Check versions now" and the auto-select switch,
 * go through the view's `runGuarded`, so a stale session is answered with the
 * same re-authentication prompt as every other change on this screen. A check
 * that ran tells the view (`onVersionsChanged`), whose provider rows and routing
 * cards show the same lists.
 *
 * Every version shown is what the router uses now, not what the check last
 * recorded, so the table cannot describe a list nothing is using.
 */

import React, { useCallback, useEffect, useId, useMemo, useState } from 'react';
import {
    Badge,
    Button,
    Card,
    DataTable,
    Switch,
} from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import { useToast } from '@shared/components/feedback';

import {
    checkAiModelVersionsNow,
    describeAiError,
    getAiModelVersions,
    isReauthCancelled,
    setAiModelAutoSelect,
} from '../../services/aiIntegrations';
import {
    describeCheckReason,
    describeLaneStatus,
    describeServiceState,
    describeVersionResult,
    formatCheckedAt,
} from './aiModelVersionsPresentation';

const AUTO_SELECT_ON = 'On: a version that fails the check is replaced by one that passes, and Telegram says so.';
const AUTO_SELECT_OFF = 'Off: every list stays exactly as it is. The check still runs and shows what it would change.';

function LaneCell({ row, laneId, absent }) {
    const lane = row.lanes.find((entry) => entry.id === laneId);
    if (!lane) return <span className="text-ds-xs text-ds-content-secondary">{absent}</span>;
    // A stale verdict on a service the check skips would read as current.
    const status = row.state === 'ready' ? describeLaneStatus(lane.status) : null;

    return (
        <Stack gap="sm">
            {status && <span><Badge tone={status.tone}>{status.label}</Badge></span>}
            <ul className="flex flex-col gap-ds-1 text-ds-xs">
                {lane.models.map((model) => {
                    const note = describeVersionResult(model.result);
                    return (
                        <li key={model.id} className="text-ds-content">
                            {/* An id may break anywhere; the words after it may not. */}
                            <span className="break-all">{model.id}</span>
                            {note && <span className="text-ds-content-secondary"> — {note}</span>}
                        </li>
                    );
                })}
            </ul>
            {lane.suggested && lane.suggested.length > 0 && (
                <p className="text-ds-xs text-ds-content-secondary">
                    Suggested: <span className="break-all">{lane.suggested.join(', ')}</span>
                </p>
            )}
        </Stack>
    );
}

const COLUMNS = Object.freeze([
    {
        key: 'service',
        header: 'Service',
        rowHeader: true,
        priority: 'primary',
        width: 'lg',
        render: (row) => {
            const state = describeServiceState(row);
            return (
                <Stack gap="sm">
                    <span className="font-semibold text-ds-content">{row.displayName}</span>
                    <span><Badge tone={state.tone}>{state.label}</Badge></span>
                    {state.note && <span className="text-ds-xs text-ds-content-secondary">{state.note}</span>}
                </Stack>
            );
        },
    },
    {
        key: 'vision',
        header: 'Photos and documents',
        render: (row) => <LaneCell row={row} laneId="vision" absent="Does not read photos." />,
    },
    {
        key: 'text',
        header: 'Text',
        render: (row) => <LaneCell row={row} laneId="text" absent="Does not write text." />,
    },
    {
        key: 'checkedAt',
        header: 'Last checked',
        priority: 'secondary',
        width: 'lg',
        render: (row) => (
            <Stack gap="sm">
                <span className="text-ds-sm text-ds-content">{formatCheckedAt(row.checkedAt) || 'Never'}</span>
                {describeCheckReason(row.reason) && (
                    <span className="text-ds-xs text-ds-content-secondary">{describeCheckReason(row.reason)}</span>
                )}
            </Stack>
        ),
    },
]);

const services = (count) => `${count} service${count === 1 ? '' : 's'}`;

export function AiModelVersionsCard({ runGuarded, onVersionsChanged }) {
    const { showSuccess, showError, showInfo } = useToast();
    const headingId = useId();
    const hintId = useId();

    const [versions, setVersions] = useState(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [checking, setChecking] = useState(false);
    const [switching, setSwitching] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setLoadError(null);
        try {
            setVersions(await getAiModelVersions());
        } catch (error) {
            setLoadError(describeAiError(error, 'The model versions could not be loaded.'));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const handleCheckNow = useCallback(async () => {
        setChecking(true);
        showInfo('Checking every service\'s versions on a made-up licence and a short text. This can take two minutes.');
        try {
            const result = await runGuarded(() => checkAiModelVersionsNow());
            setVersions(result);
            if (result.skipped === 'running') {
                showInfo('A check is already running. Try again in a few minutes.');
                return;
            }
            onVersionsChanged?.();
            const failed = result.failedCount || 0;
            if (failed > 0) {
                showError(result.checkedCount > 0
                    ? `Checked ${services(result.checkedCount)}, but ${services(failed)} could not be checked. Try again in a few minutes.`
                    : `The check failed for ${services(failed)}. Try again in a few minutes.`);
            } else if (result.checkedCount === 0) {
                showInfo('No service could be checked: a service is checked once it is on and has its key.');
            } else {
                showSuccess(`Checked ${services(result.checkedCount)}. The table shows the versions in use now.`);
            }
        } catch (error) {
            if (isReauthCancelled(error)) return;
            showError(describeAiError(error, 'The versions could not be checked.'));
        } finally {
            setChecking(false);
        }
    }, [onVersionsChanged, runGuarded, showError, showInfo, showSuccess]);

    const handleAutoSelect = useCallback(async (enabled) => {
        setSwitching(true);
        try {
            setVersions(await runGuarded(() => setAiModelAutoSelect(enabled)));
            showSuccess(enabled
                ? 'Auto-select is on. The next check applies what it finds.'
                : 'Auto-select is off. Every list stays as it is now.');
        } catch (error) {
            if (isReauthCancelled(error)) return;
            showError(describeAiError(error, 'Auto-select could not be changed.'));
        } finally {
            setSwitching(false);
        }
    }, [runGuarded, showError, showSuccess]);

    const autoSelect = versions?.autoSelect !== false;
    const lastRun = formatCheckedAt(versions?.lastRunAt);
    const rows = useMemo(() => versions?.providers || [], [versions]);

    return (
        <Card padding="md" aria-labelledby={headingId}>
            <Stack gap="md">
                <div className="flex flex-wrap items-start justify-between gap-ds-2">
                    <div>
                        <h3 id={headingId} className="text-ds-sm font-semibold text-ds-content">Model versions</h3>
                        <p className="mt-1 text-ds-sm text-ds-content-secondary">
                            The versions of each AI service SafeHaul uses. Once a day, and within an hour of a
                            failure, each version reads a made-up licence and answers a short text. Versions
                            that fail are replaced by ones that pass, never by a service you have not turned on.
                        </p>
                    </div>
                    <Button variant="secondary" size="sm" loading={checking} onClick={handleCheckNow}>
                        Check versions now
                    </Button>
                </div>

                <div className="flex items-start gap-ds-3">
                    <Switch
                        checked={autoSelect}
                        onChange={handleAutoSelect}
                        label="Choose versions automatically"
                        disabled={!versions || switching}
                        aria-describedby={hintId}
                    />
                    <div>
                        <p className="text-ds-sm font-semibold text-ds-content" aria-hidden="true">
                            Choose versions automatically
                        </p>
                        <p id={hintId} className="text-ds-xs text-ds-content-secondary">
                            {autoSelect ? AUTO_SELECT_ON : AUTO_SELECT_OFF}
                        </p>
                    </div>
                </div>

                {versions && (
                    <p className="text-ds-xs text-ds-content-secondary" role="status">
                        {versions.running ? 'A check is running now. ' : ''}
                        {lastRun ? `Last check finished ${lastRun}.` : 'No check has run yet.'}
                    </p>
                )}

                <DataTable
                    ariaLabel="AI model versions"
                    density="compact"
                    minWidth="standard"
                    embedded
                    data={rows}
                    columns={COLUMNS}
                    isLoading={loading}
                    loadingLabel="Loading model versions"
                    error={loadError ? { message: loadError, onRetry: load } : undefined}
                    empty={{ title: 'No AI service is listed.' }}
                />
            </Stack>
        </Card>
    );
}

export default AiModelVersionsCard;
