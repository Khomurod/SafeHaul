/**
 * The presentational parts of the Unified Driver Database: the source badge
 * and its config, the filter definitions and the delete-confirmation dialog. Extracted verbatim from
 * `views/UnifiedDriverList.jsx`, whose header records the migration history
 * and the preserved behaviour; the view keeps the state and the handlers.
 */

import React from 'react';
import { FileText, User, Briefcase, Share2 } from '@design-system/icons';
import { Badge } from '@/design-system/components';
import { ConfirmDialog } from '@design-system/patterns';

/** Domain source type -> semantic tone/label. Feature-owned mapping. */
const SOURCE_CONFIG = {
    'Company App': { tone: 'info', icon: FileText, label: 'Direct App' },
    'Company Lead': { tone: 'accent', icon: Share2, label: 'Company Lead' },
    'Company Import': { tone: 'warning', icon: Briefcase, label: 'Import' },
};

const SourceBadge = ({ type }) => {
    const c = SOURCE_CONFIG[type] || { tone: 'neutral', icon: User, label: type };
    return <Badge tone={c.tone} icon={c.icon}>{c.label}</Badge>;
};

// ========== BULK ACTION BAR ==========
/** Filter definitions. Values and visible text preserved verbatim. */
const FILTERS = [
    { key: 'status', label: 'Filter by status', options: [
        ['All', 'All Status'], ['New', 'New'], ['In Review', 'In Review'],
        ['Qualified', 'Qualified'], ['Hold', 'Hold'], ['Approved', 'Approved'], ['Rejected', 'Rejected'],
    ] },
    { key: 'source', label: 'Filter by source', options: [
        ['All', 'All Sources'], ['Company App', 'Direct Applications'],
        ['Company Lead', 'Company Leads'], ['Company Import', 'Company Imports'],
    ] },
    { key: 'driverType', label: 'Filter by driver type', options: [
        ['All', 'All Types'], ['OTR', 'OTR'], ['Regional', 'Regional'], ['Local', 'Local'], ['Team', 'Team'],
    ] },
    { key: 'docsStatus', label: 'Filter by documents status', options: [
        ['All', 'All Docs'], ['Complete', 'Complete'], ['Partial', 'Partial'], ['Missing', 'Missing'],
    ] },
];


/**
 * Replaces the blocking `window.confirm` on the permanent record delete. The
 * SUPER ADMIN WARNING wording is preserved verbatim.
 *
 * The approved `ConfirmDialog` since 2026-08-25. Hand-composed before that, and
 * it carried the severity **in the heading's colour** — `text-ds-status-danger-fg`
 * on the title, with no medallion — which is status by colour alone on the most
 * destructive action in the product. The pattern's danger medallion carries it
 * instead, the wording is untouched, and initial focus lands on Cancel rather
 * than on "Permanently delete".
 */
function DeleteRecordDialog({ item, onCancel, onConfirm }) {
    const who = `${item.firstName || ''} ${item.lastName || ''}`.trim();

    return (
        <ConfirmDialog
            tone="danger"
            title="SUPER ADMIN WARNING"
            description={(
                <>
                    Are you sure you want to PERMANENTLY DELETE this record for{' '}
                    <strong className="text-ds-content">{who}</strong>? This cannot be undone.
                </>
            )}
            confirmLabel="Permanently delete"
            onCancel={onCancel}
            onConfirm={onConfirm}
        />
    );
}

export { SOURCE_CONFIG, SourceBadge, FILTERS, DeleteRecordDialog };
