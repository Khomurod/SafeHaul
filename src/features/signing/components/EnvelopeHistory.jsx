import React, { useState } from 'react';
import { Icon, FileText, Download, Copy, Eye } from '@design-system/icons';
import { useIsMobile } from '@shared/hooks/useIsMobile';
import { useMediaQuery } from '@shared/hooks/useMediaQuery';
import { Avatar, Button, DataTable, defineTableColumns } from '@/design-system/components';
import { initialsOf } from '@shared/utils/initials';
import { useSigningRequests } from '@features/signing/hooks/useSigningRequests';
import { formatSentDate, hasDeliveryFailure, isLinkExpired } from '@features/company-admin/utils/documentsWorkspace';
import { canSendSignedCopy, hasCompanySignature, isSignedCopyRetry } from '@features/signing/utils/signedCopy';
import { useSentDocumentActions } from '@features/signing/hooks/useSentDocumentActions';
import { useRerenderWhenClaimsExpire } from '@features/signing/hooks/useRerenderWhenClaimsExpire';
import { SignedCopyButton, SignedCopyStatus } from './SignedCopy';
import { EnvelopeStatusCell } from './EnvelopeStatus';
import { SentDocumentDialogs } from './SentDocumentDialogs';

/**
 * Rows per page. The list is a live window of the newest documents (100, more
 * on request); the table stays a single live list, sliced for display only, so
 * real-time updates keep flowing into whichever page is visible.
 */
const PAGE_SIZE = 25;

/*
 * On a phone card every line after the title starts where the title's text
 * does: after the 16px document glyph and its 8px gap.
 */
const CARD_INDENT = 'max-md:ps-ds-6';
const CARD_ACTION_INDENT = 'max-md:ms-ds-6';

/*
 * From 768px to 1279px the four columns would leave the title under 230px (the
 * table scrolled sideways there), so each row is one item instead: the
 * document, its status and its recipient in one column, and the quick action in
 * a fixed column beside it. Under 768px the rows are cards, from 1280px the
 * table has its four columns.
 */
const ITEM_LIST_QUERY = '(min-width: 768px) and (max-width: 1279px)';
/**
 * Where the table's two text columns, sharing what the fixed ones leave, are
 * each wide enough for a long address ("ana.ferreira-montgomery@example.test",
 * about 337px with the initials): from 1366px beside the menu. Narrower, the
 * document takes `xl` and the recipient the rest, as C2 gives the recipient its
 * room, so an address does not break after its "@".
 */
const ROOMY_TABLE_QUERY = '(min-width: 1366px)';

/** A break opportunity after the "@", so an address that must wrap wraps there first. */
function breakableContact(contact) {
    const at = contact.indexOf('@');
    if (at < 0) return contact;
    return <>{contact.slice(0, at + 1)}<wbr />{contact.slice(at + 1)}</>;
}

/**
 * The document's title, whole, with the day it was sent under it. In the table
 * the glyph is centred on the two; on a card it stays on the title's first line,
 * and the title breaks as prose there rather than into even lines.
 */
function DocumentCell({ document: docItem }) {
    const date = formatSentDate(docItem.createdAt);
    return (
        <span className="flex items-center gap-ds-2 max-md:items-start">
            <Icon icon={FileText} className="shrink-0 text-ds-status-info-fg max-md:mt-0.5" />
            <span className="min-w-0">
                <span className="block font-semibold text-ds-content [overflow-wrap:anywhere] [text-wrap:balance] max-md:[text-wrap:pretty]">
                    {docItem.title || 'Untitled'}
                </span>
                {date && (
                    <span className="block text-ds-xs font-normal text-ds-content-secondary max-md:text-ds-body">
                        Sent {date}
                    </span>
                )}
            </span>
        </span>
    );
}

/** The recipient's name and, under it, how to reach them. */
function RecipientLines({ document: docItem }) {
    const contact = docItem.recipientEmail || docItem.recipientPhone;
    return (
        <span className="block min-w-0">
            <span className="block font-semibold text-ds-content [overflow-wrap:anywhere]">{docItem.recipientName}</span>
            <span className="block text-ds-body font-normal text-ds-content-secondary [overflow-wrap:anywhere]">
                {contact ? breakableContact(contact) : 'No email or phone'}
            </span>
        </span>
    );
}

/**
 * Who it went to: initials, then the name and contact. On a card, the name and
 * contact only. The 8px gap leaves the contact the room a long address needs
 * on one line at a 1366px laptop.
 */
function RecipientCell({ document: docItem }) {
    const initials = initialsOf(docItem.recipientName);
    return (
        <div className={`flex min-w-0 items-center gap-ds-2 ${CARD_INDENT}`}>
            <span className="flex shrink-0 max-md:hidden">
                {initials
                    ? <Avatar size="sm" tone="brand">{initials}</Avatar>
                    : <Avatar size="sm" tone="placeholder" />}
            </span>
            <RecipientLines document={docItem} />
        </div>
    );
}

/**
 * One row of the tablet list (`ITEM_LIST_QUERY`): the glyph, then the title
 * and the day it was sent, the status with its delivery chips and any reason,
 * and the recipient, one under another.
 */
function DocumentItem({ document: docItem, status }) {
    const date = formatSentDate(docItem.createdAt);
    return (
        <span className="flex items-start gap-ds-3">
            <Icon icon={FileText} className="mt-0.5 shrink-0 text-ds-status-info-fg" />
            <span className="flex min-w-0 flex-col gap-ds-2 font-normal">
                <span className="block">
                    <span className="block font-semibold text-ds-content [overflow-wrap:anywhere] [text-wrap:pretty]">
                        {docItem.title || 'Untitled'}
                    </span>
                    {date && <span className="block text-ds-body text-ds-content-secondary">Sent {date}</span>}
                </span>
                {status}
                <RecipientLines document={docItem} />
            </span>
        </span>
    );
}

/**
 * Company-side sent-documents table.
 *
 * The live subscription — a window of the newest documents — lives in
 * `useSigningRequests`, which this component uses when no `documents` prop is
 * supplied (without Load older: no in-app caller does that). The Documents
 * workspace passes its already-filtered documents in instead, so the workspace
 * and this table never open two listeners on the same collection.
 *
 * Action hierarchy: every row is activatable and opens the details dialog, and
 * the Actions column holds exactly one status-specific quick action — Download
 * when signed, Copy Link when sent, Review/View details otherwise; a signed
 * document with a company signature offers Send signed copy instead until its
 * copy is sent (`useSignedCopySend`), and says under its status where the copy
 * stands. A sent document whose link ran out reads "Link expired" and offers
 * Review, not a link that no longer works. Correct, Void, Remind, Retry seal
 * and, for a failed send, Fix recipient and resend live in the details dialog;
 * what each does, with its callable/Firestore contract, confirmation, toasts
 * and per-document busy state, is `useSentDocumentActions`, which the
 * Overview's Needs attention cards share (`SentDocumentDialogs`). The status
 * badges are `EnvelopeStatus.jsx`.
 */
export default function EnvelopeHistory({
    companyId,
    companyName,
    onCorrect,
    documents,
    isLoading,
    loadError: loadErrorProp,
    onRetry,
    emptyState,
    embedded = false,
}) {
    const [page, setPage] = useState(1);
    // Quick actions stay `sm` on desktop for row density and take the 44px
    // control height on a phone, where each row is a card and a 36px target is
    // too small. Each fills its column, so the actions line up as one.
    const isMobile = useIsMobile();
    const quickActionSize = isMobile ? 'md' : 'sm';
    const itemList = useMediaQuery(ITEM_LIST_QUERY);
    const roomyTable = useMediaQuery(ROOMY_TABLE_QUERY);
    const actions = useSentDocumentActions({ companyId, companyName, onCorrect });
    const { copyingId, copyLink: handleCopyLink, download: handleDownload, openDetails: setDetailsDocument, signedCopy } = actions;

    // Only subscribes when the parent is not already supplying the data.
    const ownSubscription = useSigningRequests(documents ? null : companyId);

    const docs = documents ?? ownSubscription.documents;
    const loading = documents ? Boolean(isLoading) : ownSubscription.isLoading;
    const loadError = documents ? loadErrorProp : ownSubscription.loadError;
    const retry = documents ? onRetry : ownSubscription.retry;
    // A copy still being sent turns into Try again when its claim lapses.
    useRerenderWhenClaimsExpire(docs.map(signedCopy.recordFor));

    /**
     * Exactly one status-specific quick action per row. The row itself opens the
     * details dialog, where every other permitted operation (Copy Link, Correct,
     * Void, Download) remains available with its original contract.
     */
    const renderQuickAction = (docItem) => {
        const title = docItem.title || 'Untitled';

        let action;
        const copyRecord = signedCopy.recordFor(docItem);
        if (hasDeliveryFailure(docItem) || docItem.status === 'error_sealing' || isLinkExpired(docItem)) {
            action = (
                <Button
                    variant="secondary"
                    size={quickActionSize}
                    fullWidth
                    className={CARD_ACTION_INDENT}
                    aria-label={`Review details for ${title}`}
                    title={isLinkExpired(docItem) && !hasDeliveryFailure(docItem)
                        ? 'The signing link expired'
                        : 'Review the delivery or sealing failure'}
                    onClick={() => setDetailsDocument(docItem)}
                >
                    <Icon icon={Eye} size="sm" /> Review
                </Button>
            );
        } else if (canSendSignedCopy(docItem, copyRecord)) {
            action = (
                <SignedCopyButton
                    title={title}
                    retry={isSignedCopyRetry(copyRecord)}
                    size={quickActionSize}
                    fullWidth
                    className={CARD_ACTION_INDENT}
                    onClick={() => signedCopy.request(docItem)}
                />
            );
        } else if (docItem.status === 'signed') {
            action = (
                <Button
                    variant="secondary"
                    size={quickActionSize}
                    fullWidth
                    className={CARD_ACTION_INDENT}
                    aria-label={`Download ${title}`}
                    title="Download the signed document"
                    onClick={() => handleDownload(docItem.signedPdfUrl || docItem.storagePath)}
                >
                    <Icon icon={Download} size="sm" /> Download
                </Button>
            );
        } else if (docItem.status === 'sent') {
            action = (
                <Button
                    variant="secondary"
                    size={quickActionSize}
                    fullWidth
                    className={CARD_ACTION_INDENT}
                    loading={copyingId === docItem.id}
                    aria-label={`Link for ${title}`}
                    title="Copy full signing link"
                    onClick={() => handleCopyLink(docItem)}
                >
                    {copyingId !== docItem.id && <Icon icon={Copy} size="sm" />} Copy link
                </Button>
            );
        } else {
            action = (
                <Button
                    variant="secondary"
                    size={quickActionSize}
                    fullWidth
                    className={CARD_ACTION_INDENT}
                    aria-label={`View details for ${title}`}
                    title="Open document details"
                    onClick={() => setDetailsDocument(docItem)}
                >
                    <Icon icon={Eye} size="sm" /> View details
                </Button>
            );
        }

        return action;
    };

    /** Where it stands and how it was delivered, with where a signed copy stands. */
    const renderStatus = (docItem, layout) => {
        const copyRecord = hasCompanySignature(docItem) ? signedCopy.recordFor(docItem) : null;
        return (
            <EnvelopeStatusCell
                document={docItem}
                layout={layout}
                extra={copyRecord
                    ? <SignedCopyStatus record={copyRecord} size={layout === 'item' ? 'text-ds-body' : 'text-ds-xs max-md:text-ds-body'} />
                    : null}
            />
        );
    };

    /*
     * "Send signed copy" is the longest quick action: where a listed document
     * offers it, the column takes the next step so the label stays on one line
     * in its button.
     */
    const offersSignedCopy = docs.some((docItem) => canSendSignedCopy(docItem, signedCopy.recordFor(docItem)));

    /** The one quick action, in a column of its own at every width but a phone's. */
    const actionsColumn = {
        key: 'actions',
        header: 'Actions',
        align: 'end',
        // 'lg', not 'actions': one labelled quick action needs a real column,
        // and the old 64px 'actions' width is what stacked buttons vertically.
        width: offersSignedCopy ? 'xl' : 'lg',
        mobileRole: 'actions',
        // A quick action must never also activate the row.
        stopPropagation: true,
        render: renderQuickAction,
    };

    /*
     * The document, with when it was sent under it; who it went to; where it
     * stands and how it was delivered ("Status · Delivery", the reason under a
     * failed delivery's badge, because the reason explains the status); and the
     * one quick action. The two text columns share what the fixed ones leave,
     * and nothing is cut: titles, names and addresses wrap.
     *
     * On a tablet (`ITEM_LIST_QUERY`) the first three are one column, read as
     * one item, beside the action. On a phone each row is a card: the title,
     * the status and delivery chips, the recipient, then the action across the
     * card, each line starting where the title's text does, after the glyph.
     */
    const columns = defineTableColumns(itemList ? [
        {
            key: 'title',
            header: 'Document · Status · Recipient',
            rowHeader: true,
            width: 'auto',
            render: (docItem) => <DocumentItem document={docItem} status={renderStatus(docItem, 'item')} />,
        },
        actionsColumn,
    ] : [
        {
            key: 'title',
            header: 'Document',
            rowHeader: true,
            // Under 1366px the recipient's address needs the room more than the
            // title does: a title wraps between its words (`ROOMY_TABLE_QUERY`).
            width: roomyTable ? 'auto' : 'xl',
            render: (docItem) => <DocumentCell document={docItem} />,
        },
        {
            key: 'recipient',
            header: 'Recipient',
            width: 'auto',
            mobileRole: 'line',
            render: (docItem) => <RecipientCell document={docItem} />,
        },
        {
            key: 'status',
            header: 'Status · Delivery',
            // `lg`: the widest status ("Awaiting signature") is a non-wrapping badge.
            width: 'lg',
            // Right under the title on a card, before the recipient.
            mobileRole: 'meta',
            render: (docItem) => <div className={CARD_INDENT}>{renderStatus(docItem, 'table')}</div>,
        },
        actionsColumn,
    ]);

    /**
     * Display-only pagination over the live list. The page is clamped against
     * the current document count, so a filter change or live deletion that
     * shrinks the list can never leave the table on a page that no longer
     * exists. 25 or fewer documents fit one page; the footer still says how
     * many there are and "Page 1 of 1", as on every list page (C2).
     */
    const totalPages = Math.max(1, Math.ceil(docs.length / PAGE_SIZE));
    const currentPage = Math.min(page, totalPages);
    // Persist the clamp (render-time state adjustment, not an effect): if it
    // only derived `currentPage`, a list that shrinks below a page and later
    // grows again would resurrect the stale page and silently skip the first
    // 25 documents.
    if (currentPage !== page) setPage(currentPage);
    const paged = docs.length > PAGE_SIZE;
    const visibleDocs = paged ? docs.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE) : docs;
    const pagination = docs.length > 0
        ? {
            label: `${docs.length.toLocaleString('en-US')} total`,
            currentPage,
            totalPages,
            hasPrev: currentPage > 1,
            hasNext: currentPage < totalPages,
            onPrev: () => setPage(Math.max(1, currentPage - 1)),
            onNext: () => setPage(Math.min(totalPages, currentPage + 1)),
        }
        : undefined;

    return (
        <>
            <DataTable
                ariaLabel="Document history"
                mobilePresentation="cards"
                // Two columns on a tablet fit its width; four need the table's 920px.
                minWidth={itemList ? 'none' : 'wide'}
                embedded={embedded}
                data={visibleDocs}
                columns={columns}
                isLoading={loading}
                loadingLabel="Loading document history"
                error={loadError ? { message: loadError, onRetry: retry } : undefined}
                empty={emptyState || { title: 'No documents sent yet.' }}
                getRowLabel={(docItem) => `Details for ${docItem.title || 'Untitled'}`}
                onRowActivate={setDetailsDocument}
                pagination={pagination}
            />

            {/*
              Row-level details and the dialogs their actions open. The signing
              token is never rendered, only copied to the clipboard through the
              authenticated callable.
            */}
            <SentDocumentDialogs actions={actions} />
        </>
    );
}
