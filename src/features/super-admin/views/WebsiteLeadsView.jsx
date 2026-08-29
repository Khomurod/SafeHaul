import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';

import { Badge, Button, Card, DataTable, FieldMessage } from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import { useToast } from '@shared/components/feedback';

import { describeLeadsError, listWebsiteLeads } from '../services/websiteLeads';

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

/**
 * Escapes one CSV cell.
 *
 * **The leading apostrophe is not decoration.** Every value here was typed by a
 * member of the public, and a spreadsheet treats a cell beginning `=`, `+`, `-`
 * or `@` as a formula — so `=HYPERLINK(...)` in a "company name" runs when an
 * operator opens the export. Prefixing those with `'` makes the cell text.
 * Quote-doubling handles the ordinary case of a comma or quote in a field.
 */
function csvCell(value) {
    if (value === null || value === undefined) return '';
    const raw = String(value);
    const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
    return `"${safe.replaceAll('"', '""')}"`;
}

function toCsv(leads) {
    const header = CSV_COLUMNS.map(([name]) => csvCell(name)).join(',');
    const rows = leads.map((lead) => CSV_COLUMNS.map(([, read]) => csvCell(read(lead))).join(','));
    return [header, ...rows].join('\r\n');
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
            // A BOM, so Excel reads the file as UTF-8 rather than the local
            // codepage — without it an accented name arrives mangled.
            const blob = new Blob([`\uFEFF${toCsv(leads)}`], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `safehaul-website-leads-${new Date().toISOString().slice(0, 10)}.csv`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
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
            priority: 'primary',
            width: 'lg',
            render: (lead) => (
                <div className="flex flex-col gap-ds-1">
                    <span className="font-medium text-ds-content">{lead.fullName || 'Unnamed'}</span>
                    <span className="text-ds-sm text-ds-content-secondary">{lead.workEmail}</span>
                </div>
            ),
        },
        {
            key: 'company',
            header: 'Company',
            priority: 'secondary',
            width: 'md',
            render: (lead) => (
                <div className="flex flex-col gap-ds-1">
                    <span className="text-ds-sm text-ds-content">{lead.companyName || '—'}</span>
                    {lead.companySize && (
                        <span className="text-ds-sm text-ds-content-secondary">{lead.companySize} drivers</span>
                    )}
                </div>
            ),
        },
        {
            key: 'stage',
            header: 'Stage',
            priority: 'secondary',
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
            priority: 'secondary',
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
            priority: 'tertiary',
            width: 'sm',
            render: (lead) => (
                <span className="text-ds-sm text-ds-content-secondary">
                    {lead.createdAt ? new Date(lead.createdAt).toLocaleString() : '—'}
                </span>
            ),
        },
    ], []);

    return (
        <Stack gap="lg">
            <div className="flex flex-wrap items-start justify-between gap-ds-3">
                <div>
                    <h2 className="text-ds-heading-md font-semibold text-ds-content">
                        Website Leads
                    </h2>
                    <p className="mt-1 max-w-prose text-ds-sm text-ds-content-secondary">
                        Leads captured by the SafeHaul marketing site before it was retired.
                        This is a read-only archive — nothing new arrives here, and a rebuilt
                        contact form will collect leads separately.
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-ds-2">
                    <Button variant="secondary" onClick={load} disabled={loading}>
                        <RefreshCw size={14} aria-hidden="true" /> Refresh
                    </Button>
                    <Button
                        variant="primary"
                        onClick={exportCsv}
                        disabled={loading || leads.length === 0}
                    >
                        <Download size={14} aria-hidden="true" /> Export CSV
                    </Button>
                </div>
            </div>

            {loadError && (
                <Card padding="md" tone="danger">
                    <FieldMessage tone="error">{loadError}</FieldMessage>
                </Card>
            )}

            <DataTable
                ariaLabel="Leads captured from the retired marketing site"
                density="compact"
                minWidth="lg"
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
