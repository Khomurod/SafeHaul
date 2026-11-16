import React, { useState, useEffect, useRef } from 'react';
import { Icon, Calendar, Users, MessageSquare, ChevronRight, MoreVertical, Trash2, Ban } from '@design-system/icons';
import { Badge, Card, IconButton, ProgressBar } from '@/design-system/components';
import { campaignMethodLabel, campaignStatusPresentation, isCancellableSessionStatus } from '../constants/campaignConstants';
import { formatDate } from '@shared/utils/helpers';

/** The bar's colour by the campaign's status: green once done, red when it failed, teal while it runs. */
const PROGRESS_TONES = Object.freeze({ completed: 'success', failed: 'danger' });

/** `onClick` opens the campaign: a draft in its editor, a sent or live one in its report. */
export function CampaignCard({ campaign, onClick, onDelete, onCancel }) {
    const [showMenu, setShowMenu] = useState(false);
    const menuRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (menuRef.current && !menuRef.current.contains(event.target)) {
                setShowMenu(false);
            }
        };
        const handleKeyDown = (event) => {
            if (event.key === 'Escape') setShowMenu(false);
        };
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, []);

    // The same status map as the campaign report (`campaignConstants`).
    const { tone, label } = campaignStatusPresentation(campaign.status);
    const method = campaignMethodLabel(campaign.messageConfig?.method);
    const date = campaign.updatedAt?.toDate() ? formatDate(campaign.updatedAt.toDate()) : 'Just now';

    return (
        <Card
            as="article"
            onClick={onClick}
            className="group flex cursor-pointer flex-col gap-ds-3 transition-all hover:border-ds-action-primary hover:shadow-ds-md"
        >
            <div className="flex items-center justify-between gap-ds-2">
                <Badge tone={tone}>{label}</Badge>

                <div className="relative" ref={menuRef}>
                    <IconButton
                        label="Campaign options"
                        size="sm"
                        variant="ghost"
                        aria-haspopup="menu"
                        aria-expanded={showMenu}
                        onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}
                    >
                        <Icon icon={MoreVertical} size="lg" />
                    </IconButton>

                    {showMenu && (
                        <div
                            role="menu"
                            aria-label="Campaign actions"
                            className="absolute right-0 top-full z-ds-dropdown mt-ds-1 w-48 rounded-ds-lg border border-ds-border-subtle bg-ds-surface py-ds-1 shadow-ds-lg"
                        >
                            {/* Live sessions must be cancelled (worker stops safely, history
                                is kept); only drafts and stopped sessions can be deleted. */}
                            {onCancel && isCancellableSessionStatus(campaign.status) ? (
                                <button
                                    type="button"
                                    role="menuitem"
                                    onClick={(e) => { e.stopPropagation(); setShowMenu(false); onCancel(campaign); }}
                                    className="flex w-full items-center gap-ds-2 px-ds-4 py-ds-2 text-left text-ds-sm font-medium text-ds-status-warning-fg hover:bg-ds-surface-subtle focus-visible:bg-ds-surface-subtle focus-visible:outline-none"
                                >
                                    <Icon icon={Ban} size="sm" /> Cancel Campaign
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    role="menuitem"
                                    onClick={(e) => { e.stopPropagation(); setShowMenu(false); onDelete && onDelete(campaign); }}
                                    className="flex w-full items-center gap-ds-2 px-ds-4 py-ds-2 text-left text-ds-sm font-medium text-ds-status-danger-fg hover:bg-ds-surface-subtle focus-visible:bg-ds-surface-subtle focus-visible:outline-none"
                                >
                                    <Icon icon={Trash2} size="sm" /> Delete Campaign
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* The name wraps rather than being cut. The message is a preview of
                a body that can run to pages: two lines, the rest one press away. */}
            <h3 className="text-ds-heading-md font-semibold text-ds-content transition-colors [overflow-wrap:anywhere] group-hover:text-ds-action-primary">
                {campaign.name || 'Untitled Campaign'}
            </h3>
            <p className="line-clamp-2 text-ds-body text-ds-content-secondary">
                {campaign.messageConfig?.message || 'No content defined...'}
            </p>

            {campaign.progress && <CampaignProgress campaign={campaign} />}

            {/* One row: the facts at the start, Details at the end; Details
                wraps under them only when the card is too narrow for both. Its
                row is 24px to press (WCAG 2.5.8), 44px on a phone. */}
            <div className="mt-auto flex flex-wrap items-center justify-between gap-x-ds-3 gap-y-ds-2 border-t border-ds-border-subtle pt-ds-3">
                <span className="flex flex-wrap items-center gap-x-ds-3 gap-y-ds-1 text-ds-xs text-ds-content-secondary">
                    <span className="inline-flex items-center gap-ds-1 whitespace-nowrap">
                        <Icon icon={Users} size="sm" />
                        {campaign.matchCount || 0} leads
                    </span>
                    <span className="inline-flex items-center gap-ds-1 whitespace-nowrap">
                        <Icon icon={MessageSquare} size="sm" />
                        {method}
                    </span>
                    <span className="inline-flex items-center gap-ds-1 whitespace-nowrap">
                        <Icon icon={Calendar} size="sm" />
                        {date}
                    </span>
                </span>

                <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onClick?.(); }}
                    className="ms-auto inline-flex items-center gap-ds-1 whitespace-nowrap rounded-ds-sm text-ds-body font-semibold text-ds-content-link hover:underline focus-visible:outline-none focus-visible:shadow-ds-focus min-h-ds-6 max-md:min-h-ds-control"
                >
                    Details <Icon icon={ChevronRight} size="sm" />
                </button>
            </div>
        </Card>
    );
}

/**
 * How far a sent or live campaign has got: the counts, a share of the whole and
 * the bar, green once it completed. A failed send count stays in the same line.
 */
function CampaignProgress({ campaign }) {
    const { processedCount = 0, totalCount = 0, failedCount = 0 } = campaign.progress;
    const percent = totalCount > 0 ? Math.round((processedCount / totalCount) * 100) : 0;
    const barTone = PROGRESS_TONES[campaign.status] ?? 'info';
    return (
        <div className="flex flex-col gap-ds-2">
            <div className="flex flex-wrap items-center justify-between gap-x-ds-3 gap-y-ds-1 text-ds-xs">
                <span className="text-ds-content-secondary">Progress</span>
                <span className="flex flex-wrap items-center justify-end gap-x-ds-2 font-bold tabular-nums text-ds-content-secondary">
                    {failedCount > 0 && (
                        <span className="text-ds-status-danger-fg">{failedCount} Failed</span>
                    )}
                    <span>
                        <span>{processedCount} / {totalCount}</span> · {percent}%
                    </span>
                </span>
            </div>
            <ProgressBar value={processedCount} max={totalCount || 1} label="Send progress" tone={barTone} />
        </div>
    );
}
