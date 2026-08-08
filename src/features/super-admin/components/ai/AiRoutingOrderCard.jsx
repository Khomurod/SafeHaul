import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, GripVertical, RotateCcw } from 'lucide-react';

import { Badge, Button, Card, IconButton } from '@/design-system/components';
import { Stack } from '@/design-system/layouts';

import { describeProviderState } from './aiProviderPresentation';

/**
 * The order the router tries providers in, and the control that changes it.
 *
 * Two ways to reorder, and they are equals rather than a primary and a
 * fallback: pointer drag, and a pair of move controls on every row. The move
 * controls are the reason this screen is operable at all without a mouse, so
 * they are always rendered, always labelled with the provider they move, and
 * they keep focus on the row that moved. HTML5 drag-and-drop reports nothing to
 * assistive technology on its own, which is why the live region below announces
 * each move in words.
 *
 * Reordering is a draft until it is saved. Nothing routes differently because
 * an operator dragged a row and then changed their mind, and "Discard changes"
 * is offered rather than only a browser refresh.
 *
 * Drag uses the platform's own drag events rather than `react-draggable`. That
 * library translates one element with a CSS transform and reports pixel
 * offsets; a list reorder would then have to infer an index from coordinates
 * and keep a parallel visual model in sync. Native `dragover` gives the target
 * row directly, so the list stays the single source of truth.
 */
export function AiRoutingOrderCard({
    providers,
    usingDefaultOrder,
    saving,
    onSave,
}) {
    /** Ids in saved order — what the server currently has. */
    const savedOrder = useMemo(() => providers.map((provider) => provider.id), [providers]);

    /**
     * The operator's in-progress reorder, or `null` when they have not moved
     * anything. The rendered list is therefore `pending ?? savedOrder`, which
     * is what makes the list correct on the very first paint: the rows arrive
     * from an asynchronous load, and a draft copied into state by an effect
     * would render empty for the commit in between.
     */
    const [pending, setPending] = useState(null);
    const [syncedTo, setSyncedTo] = useState(savedOrder);
    const [announcement, setAnnouncement] = useState('');
    const [draggingId, setDraggingId] = useState(null);

    // Refs to the move controls, so the button an operator just pressed keeps
    // focus after the row moves. Without this a keyboard user is returned to
    // the top of the document on every single move.
    const moveRefs = useRef(new Map());
    const refocus = useRef(null);

    // A reload — including the one that follows a successful save — replaces
    // the draft, because what the server holds is now the truth. Adjusting
    // during render rather than in an effect: the alternative renders one frame
    // of stale list, and after a save that frame shows the operator their own
    // unsaved draft as though it had been stored.
    if (savedOrder !== syncedTo) {
        setSyncedTo(savedOrder);
        setPending(null);
    }

    const draft = pending || savedOrder;

    useEffect(() => {
        if (!refocus.current) return;
        const node = moveRefs.current.get(refocus.current);
        refocus.current = null;
        if (node) node.focus();
    });

    const byId = useMemo(
        () => new Map(providers.map((provider) => [provider.id, provider])),
        [providers],
    );

    const dirty = useMemo(
        () => draft.length !== savedOrder.length || draft.some((id, index) => id !== savedOrder[index]),
        [draft, savedOrder],
    );

    /**
     * Moves one provider to an absolute index.
     *
     * The new list and the announcement are both computed from the current
     * draft *before* any state is set, rather than inside an updater: an
     * updater can be invoked more than once for a single change, and announcing
     * from inside one produces duplicate or out-of-order live-region text.
     */
    const moveTo = useCallback((providerId, targetIndex) => {
        const from = draft.indexOf(providerId);
        if (from === -1) return;
        const to = Math.max(0, Math.min(draft.length - 1, targetIndex));
        if (to === from) return;

        const next = draft.slice();
        next.splice(from, 1);
        next.splice(to, 0, providerId);

        const name = byId.get(providerId)?.displayName || providerId;
        setPending(next);
        setAnnouncement(`${name} moved to position ${to + 1} of ${next.length}. Not saved yet.`);
    }, [byId, draft]);

    const moveBy = useCallback((providerId, delta, direction) => {
        // Focus follows the control that was pressed, onto the row that moved.
        refocus.current = `${providerId}:${direction}`;
        moveTo(providerId, draft.indexOf(providerId) + delta);
    }, [draft, moveTo]);

    const handleDrop = useCallback((targetId) => {
        if (!draggingId || draggingId === targetId) return;
        moveTo(draggingId, draft.indexOf(targetId));
        setDraggingId(null);
    }, [draft, draggingId, moveTo]);

    const handleReset = useCallback(() => {
        setPending(null);
        setAnnouncement('Order reset to what is currently saved.');
    }, []);

    const handleSave = useCallback(() => {
        setAnnouncement('');
        onSave(draft);
    }, [draft, onSave]);

    if (providers.length === 0) return null;

    return (
        <Card padding="md">
            <Stack gap="sm">
                <div>
                    <h3 className="text-ds-sm font-semibold text-ds-content">Routing order</h3>
                    <p className="mt-1 text-ds-sm text-ds-content-secondary">
                        The order the shared router tries providers in for every AI task. Drag a row, or
                        use its move controls, then save. A provider is still skipped when it cannot do
                        the job, is disabled, unconfigured or in cooldown — ordering decides who is asked
                        first, not who is eligible.
                        {' '}
                        {usingDefaultOrder
                            ? 'This deployment is running the built-in default order.'
                            : 'This deployment is running an operator-chosen order.'}
                    </p>
                </div>

                <ol className="flex flex-col gap-ds-1" aria-label="AI provider routing order">
                    {draft.map((providerId, index) => {
                        const provider = byId.get(providerId);
                        if (!provider) return null;
                        const state = describeProviderState(provider);

                        return (
                            <li
                                key={providerId}
                                draggable
                                onDragStart={(event) => {
                                    setDraggingId(providerId);
                                    // Firefox will not start a drag without data on the transfer.
                                    event.dataTransfer.effectAllowed = 'move';
                                    event.dataTransfer.setData('text/plain', providerId);
                                }}
                                onDragOver={(event) => { event.preventDefault(); }}
                                onDrop={(event) => { event.preventDefault(); handleDrop(providerId); }}
                                onDragEnd={() => setDraggingId(null)}
                                className={`flex items-center gap-ds-2 rounded border border-ds-border bg-ds-surface px-ds-2 py-ds-1 ${
                                    draggingId === providerId ? 'border-ds-action-primary' : ''
                                }`}
                            >
                                <GripVertical
                                    size={14}
                                    aria-hidden="true"
                                    className="text-ds-content-secondary"
                                />
                                <Badge tone="neutral">{index + 1}</Badge>
                                <span className="font-semibold text-ds-content">{provider.displayName}</span>
                                <Badge tone={state.tone}>{state.label}</Badge>

                                <span className="ml-auto flex gap-ds-1">
                                    <IconButton
                                        size="sm"
                                        variant="secondary"
                                        label={`Move ${provider.displayName} up`}
                                        disabled={index === 0}
                                        ref={(node) => {
                                            const key = `${providerId}:up`;
                                            if (node) moveRefs.current.set(key, node);
                                            else moveRefs.current.delete(key);
                                        }}
                                        onClick={() => moveBy(providerId, -1, 'up')}
                                    >
                                        <ArrowUp size={14} aria-hidden="true" />
                                    </IconButton>
                                    <IconButton
                                        size="sm"
                                        variant="secondary"
                                        label={`Move ${provider.displayName} down`}
                                        disabled={index === draft.length - 1}
                                        ref={(node) => {
                                            const key = `${providerId}:down`;
                                            if (node) moveRefs.current.set(key, node);
                                            else moveRefs.current.delete(key);
                                        }}
                                        onClick={() => moveBy(providerId, 1, 'down')}
                                    >
                                        <ArrowDown size={14} aria-hidden="true" />
                                    </IconButton>
                                </span>
                            </li>
                        );
                    })}
                </ol>

                {/* Drag reports nothing to a screen reader, and neither does a
                    row silently changing index. Every move is announced. */}
                <span role="status" aria-live="polite" className="text-ds-xs text-ds-content-secondary">
                    {announcement}
                </span>

                {dirty && (
                    <div className="flex flex-wrap gap-ds-2">
                        <Button variant="primary" loading={saving} onClick={handleSave}>
                            Save routing order
                        </Button>
                        <Button variant="secondary" disabled={saving} onClick={handleReset}>
                            <RotateCcw size={14} aria-hidden="true" /> Discard changes
                        </Button>
                    </div>
                )}
            </Stack>
        </Card>
    );
}

export default AiRoutingOrderCard;
