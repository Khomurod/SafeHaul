/**
 * The presentational parts of the Unified Driver Database: the source badge
 * and its config, the bulk-action bar, the filter definitions and the
 * delete-confirmation dialog. Extracted verbatim from
 * `views/UnifiedDriverList.jsx`, whose header records the migration history
 * and the preserved behaviour; the view keeps the state and the handlers.
 */

import React from 'react';
import {
    Trash2, MessageSquare, UserPlus,
    FileText, User, Briefcase, Share2,
    ChevronUp
} from 'lucide-react';
import { Badge, Button } from '@/design-system/components';
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
/**
 * OPERATOR-SAFETY FIX (2026-07-28). Message, Assign, Move Status and Archive were
 * **false affordances**: each handler did nothing but fire a *success* toast
 * ("Archive action for 50 items"), and Archive additionally asked
 * `window.confirm("Are you sure you want to archive 50 records?")` first — so an
 * operator could confirm a destructive-sounding bulk action on 50 driver records,
 * be told it succeeded, and have nothing happen at all. On a DOT-compliance
 * surface that is a materially misleading state, not a cosmetic gap.
 *
 * No implementation is invented here, because none can be inferred safely:
 *  - **Assign**: `LeadAssignmentModal` does real bulk assignment, but only within
 *    a single company's `leads` collection. This view spans every company and
 *    mixes applications with leads, so reusing it would mean inventing
 *    cross-tenant assignment policy.
 *  - **Message**: the campaigns feature owns bulk SMS (`initBulkSession`) with its
 *    own audience, consent and throttling rules. There is no precedent for sending
 *    from here.
 *  - **Move Status**: per-record status updates exist; a cross-company bulk status
 *    transition has no precedent and no audit-log shape.
 *  - **Archive**: the view has a real *permanent delete* path, but nothing in the
 *    repository defines an "archived" state, so Archive is not delete.
 *
 * The controls are therefore kept visible (so the owner decision stays visible
 * too) but disabled and explicitly labelled as unavailable. `Clear` still works.
 * No Firebase path, callable or business rule changed. Recorded in the roadmap for
 * an owner decision.
 */
const BulkActionBar = ({ selectedCount, onClearSelection, unavailableNoteId }) => (
    <div
        role="group"
        aria-label="Bulk actions for selected records"
        className="flex flex-wrap items-center justify-between gap-ds-3 rounded-t-ds-xl bg-ds-action-primary px-ds-4 py-ds-3 text-ds-content-inverse"
    >
        <div className="flex items-center gap-ds-3">
            <span className="font-semibold" role="status">{selectedCount} selected</span>
            <Button variant="ghost" size="sm" onClick={onClearSelection}>
                Clear<span className="sr-only"> selection</span>
            </Button>
        </div>
        <div className="flex flex-wrap items-center gap-ds-2">
            <Button variant="secondary" size="sm" disabled aria-describedby={unavailableNoteId}>
                <MessageSquare size={14} aria-hidden="true" /> Message
                <span className="sr-only">{` ${selectedCount} selected records`}</span>
            </Button>
            <Button variant="secondary" size="sm" disabled aria-describedby={unavailableNoteId}>
                <UserPlus size={14} aria-hidden="true" /> Assign
                <span className="sr-only">{` ${selectedCount} selected records`}</span>
            </Button>
            <Button variant="secondary" size="sm" disabled aria-describedby={unavailableNoteId}>
                <ChevronUp size={14} aria-hidden="true" /> Move Status
                <span className="sr-only">{` for ${selectedCount} selected records`}</span>
            </Button>
            <Button variant="danger" size="sm" disabled aria-describedby={unavailableNoteId}>
                <Trash2 size={14} aria-hidden="true" /> Archive
                <span className="sr-only">{` ${selectedCount} selected records`}</span>
            </Button>
        </div>
        <p id={unavailableNoteId} className="w-full text-ds-xs text-ds-content-inverse">
            Bulk Message, Assign, Move Status and Archive are not available yet. Use a
            record&apos;s own actions instead.
        </p>
    </div>
);

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

export { SOURCE_CONFIG, SourceBadge, BulkActionBar, FILTERS, DeleteRecordDialog };
