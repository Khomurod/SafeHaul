import React from 'react';
import { Badge, Button, DataTable } from '@design-system/components';
import { PageContainer, Stack } from '@design-system/layouts';
import { ConfirmDialog } from '@shared/components/modals/ConfirmDialog';
import { ExternalLink, Trash2 } from 'lucide-react';

/**
 * The title-deletion list pattern: a deliberately small screen whose only job is
 * "show me what exists and let me remove one".
 *
 * It exists as a named pattern because the temptation with any list of generated
 * items is to grow it into a management console — filters, bulk actions, an
 * editor, a status workflow. When the items are produced automatically and are
 * not meant to be hand-edited, every one of those additions is surface area with
 * no user. This pattern is the argument for stopping at two columns.
 *
 * Fixtures are neutral: generic item titles, no product vocabulary.
 */

const ITEMS = [
    { id: 'item-1', title: 'Quarterly summary of published guidance', date: '2026-08-02', status: 'live' },
    { id: 'item-2', title: 'How to shorten a slow intake process', date: '2026-08-02', status: 'live' },
    { id: 'item-3', title: 'An item that has already been removed', date: '2026-08-01', status: 'removed' },
];

function columns() {
    return [
        {
            key: 'title',
            header: 'Title',
            rowHeader: true,
            priority: 'primary',
            width: 'xl',
            render: (item) => (
                <div className="flex flex-col gap-ds-1">
                    <span className="font-medium text-ds-content">{item.title}</span>
                    {item.status === 'removed' && <Badge tone="neutral">Removed</Badge>}
                </div>
            ),
        },
        {
            key: 'date',
            header: 'Published',
            priority: 'secondary',
            width: 'sm',
            render: (item) => <span className="text-ds-sm text-ds-content-secondary">{item.date}</span>,
        },
        {
            key: 'actions',
            header: 'Actions',
            priority: 'actions',
            width: 'actions',
            align: 'end',
            render: (item) => (
                <div className="flex justify-end gap-ds-1">
                    {item.status !== 'removed' && (
                        <>
                            <Button size="sm" variant="ghost" aria-label={`View ${item.title}`}>
                                <ExternalLink size={14} aria-hidden="true" /> View
                            </Button>
                            <Button size="sm" variant="danger" aria-label={`Delete ${item.title}`}>
                                <Trash2 size={14} aria-hidden="true" /> Delete
                            </Button>
                        </>
                    )}
                </div>
            ),
        },
    ];
}

function DeletionListPage({ data = ITEMS, isLoading = false, empty, dialog = null }) {
    return (
        <div className="min-h-screen bg-ds-canvas">
            <PageContainer>
                <Stack gap="lg">
                    <div>
                        <h2 className="text-ds-heading-lg font-bold text-ds-content">Published items</h2>
                        <p className="mt-1 text-ds-sm text-ds-content-secondary">
                            Items published automatically. Deleting one removes it from every public
                            surface immediately.
                        </p>
                    </div>

                    <DataTable
                        ariaLabel="Published items"
                        density="compact"
                        minWidth="md"
                        data={data}
                        columns={columns()}
                        isLoading={isLoading}
                        loadingLabel="Loading items"
                        empty={empty || { title: 'Nothing has been published yet.' }}
                    />
                </Stack>
            </PageContainer>

            {dialog === 'confirm' && (
                <ConfirmDialog
                    title="Delete this item?"
                    description={`"${ITEMS[0].title}" will be removed from every public surface immediately.`}
                    tone="danger"
                    confirmLabel="Delete item"
                    cancelLabel="Keep item"
                    onConfirm={() => {}}
                    onCancel={() => {}}
                />
            )}

            {dialog === 'error' && (
                <ConfirmDialog
                    title="Delete this item?"
                    description={`"${ITEMS[0].title}" will be removed from every public surface immediately.`}
                    tone="danger"
                    confirmLabel="Delete item"
                    cancelLabel="Keep item"
                    error="That item no longer exists. Refresh the list."
                    onConfirm={() => {}}
                    onCancel={() => {}}
                />
            )}
        </div>
    );
}

const meta = {
    title: 'Patterns/Title deletion list',
    parameters: {
        layout: 'fullscreen',
        docs: {
            description: {
                component: [
                    '**Status: Approved composition, visual regression Needs review.** Built entirely',
                    'from approved primitives. Screenshot baselines are still an open roadmap item, so',
                    'this is reviewed by eye at 1440, 1024 and 412px.',
                    '',
                    '### What this pattern is for',
                    '',
                    'A list of automatically-generated items where the only supported operation is',
                    'removal. It is the deliberate opposite of a management console.',
                    '',
                    '### The rules it encodes',
                    '',
                    '1. **Two columns and an action.** Title, a date to disambiguate similar titles,',
                    '   and the actions. No filters, no bulk selection, no editor, no status workflow —',
                    '   because the items are not hand-authored and none of that has a user.',
                    '2. **The date earns its place.** It is there only because two items can share a',
                    '   subject and the date is what tells them apart.',
                    '3. **Every action names its target.** "Delete" repeated down a column is unusable',
                    '   with a screen reader, so the accessible name carries the item title.',
                    '4. **Deletion confirms, and the confirmation quotes the title.** An operator must',
                    '   be able to see *which* item they are about to remove without looking back at',
                    '   the row behind the dialog.',
                    '5. **An already-removed item keeps its row and loses its actions.** It is labelled',
                    '   rather than hidden, so the list explains itself instead of appearing to have',
                    '   lost something.',
                    '6. **A failure stays in the dialog.** The dialog does not close on a server',
                    '   refusal, because closing it would look like the deletion succeeded.',
                    '',
                    '### Deliberately not shown',
                    '',
                    'Item titles are neutral placeholders. The catalog does not know what kind of',
                    'content any particular product publishes.',
                ].join('\n'),
            },
        },
    },
};

export default meta;

/** The default list: live items with actions, one removed item labelled. */
export const Default = { render: () => <DeletionListPage /> };

/** A single live item. */
export const SingleItem = { render: () => <DeletionListPage data={[ITEMS[0]]} /> };

/** An item already removed: labelled, and offering no further actions. */
export const RemovedItem = { render: () => <DeletionListPage data={[ITEMS[2]]} /> };

/** The confirmation, quoting the title so the target is unambiguous. */
export const ConfirmingDeletion = { render: () => <DeletionListPage dialog="confirm" /> };

/** A server refusal, reported inside the dialog rather than by closing it. */
export const DeletionFailed = { render: () => <DeletionListPage dialog="error" /> };

export const Loading = { render: () => <DeletionListPage data={[]} isLoading /> };

export const Empty = {
    render: () => (
        <DeletionListPage
            data={[]}
            empty={{
                title: 'Nothing has been published yet.',
                description: 'Items appear here once the scheduled job has run.',
            }}
        />
    ),
};
