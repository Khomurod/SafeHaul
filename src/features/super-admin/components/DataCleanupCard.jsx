import React, { useCallback, useId, useRef, useState } from 'react';
import { Button, Card, Notice } from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import { ConfirmDialog } from '@design-system/patterns';
import { DATA_CLEANUP_ITEMS } from '../config/dataCleanupItems';
import { callDataCleanup, describeCleanupError, isReauthCancelled } from '../services/dataCleanup';
import { useFocusAfterRun } from '../hooks/useFocusAfterRun';
import { useReauthGuard } from '../hooks/useReauthGuard';

/**
 * Maintenance → Data cleanup: the owner's one-time removal of data older code
 * left behind, one item at a time (`dataCleanup`).
 *
 * **Check** counts what the item would change and writes nothing, so it runs at
 * once. **Run** opens only after a check found something, asks through the
 * design system's `ConfirmDialog` with the check's numbers repeated, and needs a
 * recent sign-in (`useReauthGuard`). A run that reaches the server's time limit
 * says so and can be pressed again; after every run the item is checked again,
 * so the numbers on screen are what is left.
 *
 * One request at a time: every button waits while one is in flight.
 */
export function DataCleanupCard() {
    const { runGuarded, reauthPrompt } = useReauthGuard();
    const [states, setStates] = useState({});
    const [busy, setBusy] = useState(null);
    const [confirming, setConfirming] = useState(null);
    const checkButtons = useRef({});
    const focusAfterRun = useFocusAfterRun(busy?.mode === 'run');

    const update = useCallback((item, change) => {
        setStates((previous) => ({ ...previous, [item]: { ...previous[item], ...change } }));
    }, []);

    const check = useCallback(async (item) => {
        setBusy({ item, mode: 'check' });
        try {
            update(item, { check: await callDataCleanup('check', item), error: null });
        } catch (error) {
            update(item, { error: describeCleanupError(error) });
        } finally {
            setBusy(null);
        }
    }, [update]);

    const run = useCallback(async (item) => {
        setConfirming(null);
        // The run may leave nothing to run, so focus returns to Check, which stays enabled.
        focusAfterRun.current = checkButtons.current[item] || null;
        setBusy({ item, mode: 'run' });
        try {
            const result = await runGuarded(() => callDataCleanup('run', item));
            update(item, { lastRun: result, error: null });
            update(item, { check: await callDataCleanup('check', item) });
        } catch (error) {
            if (!isReauthCancelled(error)) update(item, { error: describeCleanupError(error) });
        } finally {
            setBusy(null);
        }
    }, [focusAfterRun, runGuarded, update]);

    const confirmingItem = DATA_CLEANUP_ITEMS.find((item) => item.id === confirming);

    return (
        <Card padding="lg">
            <h3 className="mb-ds-2 text-ds-heading-sm font-semibold text-ds-content">Data cleanup</h3>
            <p className="mb-ds-4 max-w-prose text-ds-sm text-ds-content-secondary">
                One-time removal of data that older versions left behind. Press Check first: it only counts.
                Run changes the live data, asks you to confirm the numbers, and may ask for your password.
            </p>
            <Stack gap="lg">
                {DATA_CLEANUP_ITEMS.map((item) => (
                    <CleanupItem
                        key={item.id}
                        item={item}
                        state={states[item.id] || {}}
                        busy={busy}
                        onCheck={() => check(item.id)}
                        onRun={() => setConfirming(item.id)}
                        checkButtonRef={(element) => { checkButtons.current[item.id] = element; }}
                    />
                ))}
            </Stack>

            {confirmingItem && (
                <ConfirmDialog
                    tone="danger"
                    title={`Run: ${confirmingItem.title}?`}
                    description="This changes the live data that Testing and Production share. It cannot be undone."
                    confirmLabel="Run cleanup"
                    onCancel={() => setConfirming(null)}
                    onConfirm={() => { run(confirmingItem.id); }}
                >
                    <CountList item={confirmingItem} counts={states[confirmingItem.id]?.check?.counts || {}} />
                </ConfirmDialog>
            )}
            {reauthPrompt}
        </Card>
    );
}

/**
 * One item: what it does, Check and Run, the last check's numbers, and what the
 * last run did. Its outcome region is always in the DOM so it can announce.
 */
function CleanupItem({ item, state, busy, onCheck, onRun, checkButtonRef }) {
    const headingId = useId();
    const descriptionId = useId();
    const mine = busy?.item === item.id;
    const { check, lastRun, error } = state;
    // A check cut off by the time limit may not have reached the records yet;
    // Run resumes from the current state, so it is offered then too.
    const canRun = Boolean(check) && (check.total > 0 || check.done === false);

    return (
        <section aria-labelledby={headingId} className="border-t border-ds-border-subtle pt-ds-4">
            <div className="flex flex-col gap-ds-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                    <h4 id={headingId} className="text-ds-sm font-semibold text-ds-content">{item.title}</h4>
                    <p id={descriptionId} className="mt-1 max-w-prose text-ds-sm text-ds-content-secondary">
                        {item.description}
                    </p>
                </div>
                <div className="flex shrink-0 gap-ds-2">
                    <Button
                        ref={checkButtonRef}
                        variant="secondary"
                        onClick={onCheck}
                        disabled={Boolean(busy)}
                        loading={mine && busy.mode === 'check'}
                        aria-describedby={descriptionId}
                    >
                        Check
                    </Button>
                    <Button
                        variant="danger"
                        onClick={onRun}
                        disabled={Boolean(busy) || !canRun}
                        loading={mine && busy.mode === 'run'}
                        aria-describedby={descriptionId}
                    >
                        Run
                    </Button>
                </div>
            </div>

            <div role="status" className="mt-ds-3">
                {error && <Notice tone="danger" size="sm">{error}</Notice>}
                {lastRun && !error && <RunOutcome result={lastRun} />}
                {check && (
                    <div className="mt-ds-2">
                        <p className="text-ds-sm text-ds-content-secondary">
                            {checkSummary(check)}
                        </p>
                        <CountList item={item} counts={check.counts} />
                        <Examples notes={check.notes} />
                    </div>
                )}
            </div>
        </section>
    );
}

function checkSummary(check) {
    if (!check.done) return 'Check stopped at the time limit; these are the numbers so far.';
    return check.total > 0 ? 'Check found:' : 'Check found nothing to change.';
}

function RunOutcome({ result }) {
    if (!result.done) {
        return (
            <Notice tone="warning" size="sm">
                {`Not finished: ${result.total} changed before the time limit. Press Run again to go on.`}
            </Notice>
        );
    }
    return <Notice tone="success" size="sm">{`Run finished: ${result.total} changed.`}</Notice>;
}

/** The item's numbers, every one it has, in its own words. */
function CountList({ item, counts }) {
    return (
        <dl className="mt-ds-2 space-y-ds-1">
            {Object.entries(item.counts).map(([key, label]) => (
                <div key={key} className="flex justify-between gap-ds-4 text-ds-sm">
                    <dt className={item.leftAlone.includes(key) ? 'text-ds-content-muted' : 'text-ds-content-secondary'}>
                        {label}
                    </dt>
                    <dd className="font-semibold text-ds-content">{counts[key] ?? 0}</dd>
                </div>
            ))}
        </dl>
    );
}

/** Records the server names for the owner to look at, such as leads with several driver types. */
function Examples({ notes }) {
    const paths = notes?.driverTypeSeveral;
    if (!paths?.length) return null;
    return (
        <div className="mt-ds-2 text-ds-sm text-ds-content-secondary">
            <p>{`Records with several driver types${paths.length >= 20 ? ' (the first 20)' : ''}:`}</p>
            <ul className="mt-1 list-disc pl-ds-5 [overflow-wrap:anywhere]">
                {paths.map((path) => <li key={path}>{path}</li>)}
            </ul>
        </div>
    );
}
