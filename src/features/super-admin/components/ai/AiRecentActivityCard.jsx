/**
 * The "Recent AI activity" card: a count and a jump to the Logs tab, which
 * owns the real answer — a second, shallower list here would be a competing
 * answer to the same question. Extracted verbatim from
 * `AiIntegrationsView.jsx`; the tab focus handoff stays in the view's
 * `onOpenLogs` callback, beside the tab state it moves.
 */

import React from 'react';
import { ScrollText } from 'lucide-react';
import { Button, Card } from '@/design-system/components';

export function AiRecentActivityCard({ telemetry, onOpenLogs }) {
    return (
            <Card padding="md">
                <div className="flex flex-wrap items-center justify-between gap-ds-2">
                    <div>
                        <h3 className="text-ds-sm font-semibold text-ds-content">Recent AI activity</h3>
                        <p className="mt-1 text-ds-sm text-ds-content-secondary">
                            {telemetry.length > 0
                                ? `${telemetry.length} recent transaction${telemetry.length === 1 ? '' : 's'} recorded.`
                                : 'No AI requests have been recorded yet.'}
                        </p>
                    </div>
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={onOpenLogs}
                    >
                        <ScrollText size={14} aria-hidden="true" /> Open logs
                    </Button>
                </div>
            </Card>
    );
}
