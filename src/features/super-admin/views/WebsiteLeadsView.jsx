import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon, Download, RefreshCw } from '@design-system/icons';

import { Badge, Button, Card, DataTable, FieldMessage } from '@/design-system/components';
import { PageHeader, Stack } from '@/design-system/layouts';
import { useToast } from '@shared/components/feedback';

import { describeLeadsError, listWebsiteLeads } from '../services/websiteLeads';
import { downloadCsv, toCsvText } from '@shared/utils/csvExport';

/**
 * Super Admin → Website Leads.
 *
 * ## What this is
 *
 * A **read-only archive** of the leads captured by the marketing site's contact
 * form. That site was removed and lead capture, Telegram delivery, configuration,
 * test-send and delivery retry were all retired by owner decision — but the
 * records were deliberately kept, and this screen is the only way anyone reads
 * them. Any future lead capture is to be built fresh; nothing here writes.
 *
 * It replaced a 536-line Landing Page Settings screen that also managed Telegram
 * credentials. Everything that could change something is gone. What survives is
 * the table, because the data survived.
 *
 * ## Why it keeps a navigation entry
 *
 * Considered putting it somewhere less prominent, since nobody needs it daily.
 * **The archive is the only path to this data**, and a screen nobody can find
 * reads exactly like data that was deleted — which invites someone to conclude it
 * is gone and clean up the collection. It stays in `ops`, retitled, with the
 * export beside it.
 */

/** Columns, in the order the CSV writes them. One list, so the two cannot drift. */
const CSV_COLUMNS = [
    ['id', (lead) => lead.id],
    ['receivedAt', (lead) => (lead.createdAt ? new Date(lead.createdAt).toISOString() : '')],
    ['fullName', (lead) => lead.fullName],
    ['workEmail', (lead) => lead.workEmail],
    ['phone', (lead) => lead.phone],
    ['companyName', (lead) => lead.companyName],
    ['companySize', (lead) => lead.companySize],
    ['primaryGoal', (lead) => lead.primaryGoal],
    ['stage', (lead) => lead.stage],
    ['sourcePage', (lead) => lead.sourcePage],
    ['utmSource', (lead) => lead.utmSource],
    ['deliveryStatus', (lead) => lead.delivery?.status],
    ['deliveryCode', (lead) => lead.delivery?.code],
    ['deliveryAttempts', (lead) => lead.delivery?.attempts],
];

const RECEIVED_FORMAT = new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
});

/** "Oct 21, 2026, 3:05 PM", in the viewer's clock: one line in its column. */
function formatReceived(value) {
    const at = new Date(value);
    return Number.isNaN(at.getTime()) ? '—' : RECEIVED_FORMAT.format(at);
}

/** Every value here was typed by a member of the public: `csvCell` makes a formula text. */
function toCsv(leads) {
    return toCsvText([
        CSV_COLUMNS.map(([name]) => name),
        ...leads.map((lead) => CSV_COLUMNS.map(([, read]) => read(lead))),
    ]);
}

export function WebsiteLeadsView() {
    const { showError, showSuccess } = useToast();
    const [leads, setLeads] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        setLoadError('');
        try {
            setLeads(await listWebsiteLeads());
        } catch (error) {
            setLoadError(describeLeadsError(error, 'Captured leads could not be loaded.'));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const exportCsv = useCallback(() => {
        if (!leads.length) return;
        try {
            downloadCsv(`safehaul-website-leads-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(leads));
            showSuccess(`Exported ${leads.length} lead${leads.length === 1 ? '' : 's'}.`);
        } catch (error) {
            showError('That export could not be created.');
        }
    }, [leads, showError, showSuccess]);

    const columns = useMemo(() => [
        {
            key: 'contact',
            header: 'Lead',
            rowHeader: true,
            width: 'lg',
            // The email under the name, quieter: the one second line a row
            // header may carry, to tell two people of the same name apart.
            render: (lead) => (
                <div className="flex min-w-0 flex-col gap-ds-1">
                    <span className="font-medium text-ds-content">{lead.fullName || 'Unnamed'}</span>
                    <span className="truncate text-ds-sm text-ds-content-secondary" title={lead.workEmail}>
                        {lead.workEmail}
                    </span>
                </div>
            ),
        },
        {
            key: 'company',
            header: 'Company',
            width: 'lg',
            render: (lead) => (lead.companyName
                ? <span className="text-ds-sm text-ds-content">{lead.companyName}</span>
                : <span className="text-ds-sm text-ds-content-muted">—</span>),
        },
        {
            key: 'companySize',
            header: 'Drivers',
            width: 'sm',
            render: (lead) => (lead.companySize
                ? <span className="text-ds-sm text-ds-content tabular-nums">{lead.companySize}</span>
                : <span className="text-ds-sm text-ds-content-muted">—</span>),
        },
        {
            key: 'stage',
            header: 'Stage',
            width: 'sm',
            render: (lead) => (lead.stage === 'qualified'
                ? <Badge tone="success">Qualified</Badge>
                // A contact-only lead is not a failure: it is someone who gave
                // their details and stopped, which the old single form lost.
                : <Badge tone="info">Contact only</Badge>),
        },
        {
            key: 'delivery',
            header: 'Delivery',
            width: 'sm',
            render: (lead) => {
                // Historical facts about deliveries that already happened.
                // Nothing retries them; the machinery that would is gone.
                const status = lead.delivery?.status;
                if (status === 'delivered') return <Badge tone="success">Delivered</Badge>;
                if (status === 'disabled') return <Badge tone="neutral">Not sent</Badge>;
                if (status === 'failed') return <Badge tone="danger">Failed</Badge>;
                return <Badge tone="warning">Pending</Badge>;
            },
        },
        {
            key: 'createdAt',
            header: 'Received',
            width: 'lg',
            render: (lead) => (lead.createdAt
                ? <span className="text-ds-sm text-ds-content-secondary">{formatReceived(lead.createdAt)}</span>
                : <span className="text-ds-sm text-ds-content-muted">—</span>),
        },
    ], []);

    return (
        <Stack gap="lg">
            {/* Level 2: the Super Admin masthead holds the page's one <h1>. */}
            <PageHeader
                level={2}
                title="Website Leads"
                description="Leads captured by the SafeHaul marketing site before it was retired. This is a read-only archive — nothing new arrives here, and a rebuilt contact form will collect leads separately."
                count={loading || loadError ? undefined : leads.length}
                countLabel={leads.length === 1 ? 'lead' : 'leads'}
                actions={(
                    <div className="flex flex-wrap items-center gap-ds-2">
                        <Button variant="secondary" onClick={load} disabled={loading}>
                            <Icon icon={RefreshCw} size="sm" /> Refresh
                        </Button>
                        <Button
                            variant="primary"
                            onClick={exportCsv}
                            disabled={loading || leads.length === 0}
                        >
                            <Icon icon={Download} size="sm" /> Export CSV
                        </Button>
                    </div>
                )}
            />

            {loadError && (
                <Card padding="md" tone="danger">
                    <FieldMessage tone="error">{loadError}</FieldMessage>
                </Card>
            )}

            <DataTable
                ariaLabel="Leads captured from the retired marketing site"
                density="compact"
                minWidth="none"
                mobilePresentation="cards"
                data={leads}
                columns={columns}
                isLoading={loading}
                loadingLabel="Loading leads"
                empty={{
                    title: 'No leads were captured.',
                    description: 'The marketing site contact form recorded no submissions before it was retired.',
                }}
            />
        </Stack>
    );
}

export default WebsiteLeadsView;
