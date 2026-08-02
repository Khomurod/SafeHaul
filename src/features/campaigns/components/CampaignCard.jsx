import React, { useState, useEffect, useRef } from 'react';
import { Calendar, Users, MessageSquare, ChevronRight, MoreVertical, Trash2, Ban } from 'lucide-react';
import { Card, Badge, IconButton } from '@/design-system/components';
import { isCancellableSessionStatus } from '../constants/campaignConstants';

/**
 * Feature-owned domain → visual mapping for a campaign/session status.
 *
 * The design system only knows generic Badge tones; the campaigns feature owns
 * which status maps to which tone and label. Tones preserve the previous
 * appearance: active=success (emerald), completed=info (blue), scheduled=warning
 * (amber), and everything else (draft/queued/paused/cancelled/failed/unknown)
 * uses the neutral slate treatment the old default branch produced.
 */
const STATUS_TONE = {
    active: 'success',
    completed: 'info',
    scheduled: 'warning',
    draft: 'neutral',
};

function statusPresentation(status) {
    const tone = STATUS_TONE[status] || 'neutral';
    const label = typeof status === 'string' && status.length > 0
        ? status.charAt(0).toUpperCase() + status.slice(1)
        : 'Unknown';
    return { tone, label };
}

export function CampaignCard({ campaign, onClick, onDelete, onCancel, onViewReport }) {
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

    const { tone, label } = statusPresentation(campaign.status);
    const method = (campaign.messageConfig?.method || 'SMS');

    return (
        <Card
            as="article"
            onClick={onClick}
            className="group cursor-pointer transition-all hover:border-ds-action-primary hover:shadow-ds-md"
        >
            <div className="mb-ds-4 flex items-start justify-between gap-ds-2">
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
                        <MoreVertical size={18} aria-hidden="true" />
                    </IconButton>

                    {showMenu && (
                        <div
                            role="menu"
                            aria-label="Campaign actions"
                            className="absolute right-0 top-full z-10 mt-ds-1 w-48 rounded-ds-lg border border-ds-border-subtle bg-ds-surface py-ds-1 shadow-ds-lg"
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
                                    <Ban size={14} aria-hidden="true" /> Cancel Campaign
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    role="menuitem"
                                    onClick={(e) => { e.stopPropagation(); setShowMenu(false); onDelete && onDelete(campaign); }}
                                    className="flex w-full items-center gap-ds-2 px-ds-4 py-ds-2 text-left text-ds-sm font-medium text-ds-status-danger-fg hover:bg-ds-surface-subtle focus-visible:bg-ds-surface-subtle focus-visible:outline-none"
                                >
                                    <Trash2 size={14} aria-hidden="true" /> Delete Campaign
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>

            <h3 className="mb-ds-1 truncate text-ds-heading-sm font-bold text-ds-content transition-colors group-hover:text-ds-action-primary">
                {campaign.name || 'Untitled Campaign'}
            </h3>
            <p className="mb-ds-6 line-clamp-2 text-ds-sm font-medium text-ds-content-muted">
                {campaign.messageConfig?.message || 'No content defined...'}
            </p>

            <div className="border-t border-ds-border-subtle pt-ds-5">
                {campaign.progress ? (
                    <div>
                        <div className="mb-ds-2 flex items-center justify-between">
                            <span className="text-ds-xs font-bold uppercase tracking-wide text-ds-content-muted">Progress</span>
                            <span className="text-ds-xs font-bold text-ds-content-secondary">
                                {campaign.progress.processedCount} / {campaign.progress.totalCount}
                            </span>
                        </div>
                        <div
                            className="h-2 w-full overflow-hidden rounded-full bg-ds-surface-subtle"
                            role="progressbar"
                            aria-label="Send progress"
                            aria-valuenow={campaign.progress.processedCount}
                            aria-valuemin={0}
                            aria-valuemax={campaign.progress.totalCount || 1}
                        >
                            <div
                                className="h-full bg-ds-action-primary transition-all duration-500"
                                style={{ width: `${(campaign.progress.processedCount / (campaign.progress.totalCount || 1)) * 100}%` }}
                            />
                        </div>
                        <div className="mt-ds-3 flex gap-ds-4">
                            {campaign.progress.failedCount > 0 && (
                                <span className="text-ds-xs font-bold text-ds-status-danger-fg">
                                    {campaign.progress.failedCount} Failed
                                </span>
                            )}
                            <span className="ml-auto text-ds-xs font-bold uppercase text-ds-content-muted">
                                {method}
                            </span>
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 gap-ds-4">
                        <div className="flex items-center gap-ds-2 text-ds-content-muted">
                            <Users size={16} aria-hidden="true" />
                            <span className="text-ds-xs font-bold text-ds-content-secondary">{campaign.matchCount || 0} leads</span>
                        </div>
                        <div className="flex items-center gap-ds-2 text-ds-content-muted">
                            <MessageSquare size={16} aria-hidden="true" />
                            <span className="text-ds-xs font-bold uppercase text-ds-content-secondary">{method}</span>
                        </div>
                    </div>
                )}
            </div>

            <div className="mt-ds-4 flex items-center justify-between gap-ds-2 text-ds-xs font-bold uppercase tracking-wide">
                <span className="flex items-center gap-ds-1 text-ds-content-muted">
                    <Calendar size={12} aria-hidden="true" />
                    {campaign.updatedAt?.toDate() ? new Date(campaign.updatedAt.toDate()).toLocaleDateString() : 'Just now'}
                </span>

                <div className="flex items-center gap-ds-3">
                    {onViewReport && campaign.status !== 'draft' && (
                        <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onViewReport(); }}
                            className="rounded-ds-sm text-ds-content-link hover:underline focus-visible:outline-none focus-visible:shadow-ds-focus"
                        >
                            View Report
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onClick?.(); }}
                        className="flex items-center gap-0.5 rounded-ds-sm text-ds-content-muted transition-colors hover:text-ds-action-primary group-hover:text-ds-action-primary focus-visible:outline-none focus-visible:shadow-ds-focus"
                    >
                        Details <ChevronRight size={12} aria-hidden="true" />
                    </button>
                </div>
            </div>
        </Card>
    );
}
