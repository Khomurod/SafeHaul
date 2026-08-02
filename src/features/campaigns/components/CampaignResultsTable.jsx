import React, { useState, useEffect, useId } from 'react';
import { collection, query, limit, getDocs, orderBy } from 'firebase/firestore';
import { db } from '@lib/firebase';
import { CheckCircle2, AlertCircle, Clock, Search } from 'lucide-react';
import { Card, Badge, Input, Label } from '@/design-system/components';
import { getE2EQueryParam, isE2ETestMode } from '@lib/runtime/e2eMode';

// Artificial fixtures for the deterministic E2E design-system review of this
// table (populated state, scroll/sticky header, statuses, filtering). Never real
// recipient contact data — fictional 555-01xx numbers only.
const E2E_SEED_NOW = { toDate: () => new Date() };
const E2E_SEED_LOGS = Array.from({ length: 12 }, (_, i) => ({
    id: `e2e_log_${i}`,
    recipientName: `E2E Recipient ${i + 1}`,
    recipientIdentity: `555-01${String(i).padStart(2, '0')}`,
    status: i % 3 === 0 ? 'delivered' : 'failed',
    error: i % 3 === 1 ? 'Carrier rejected the message.' : undefined,
    timestamp: i === 11 ? undefined : E2E_SEED_NOW,
}));

export function CampaignResultsTable({ companyId, campaignId }) {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const searchId = useId();
    const isE2ECampaignMock = isE2ETestMode && getE2EQueryParam('e2eCampaign', '') === 'mock';

    useEffect(() => {
        const fetchLogs = async () => {
            if (!companyId || !campaignId) {
                setLoading(false);
                return;
            }
            if (isE2ECampaignMock) {
                setLogs(E2E_SEED_LOGS);
                setLoading(false);
                return;
            }
            try {
                // Fetch last 100 logs
                const q = query(
                    collection(db, 'companies', companyId, 'bulk_sessions', campaignId, 'logs'),
                    orderBy('timestamp', 'desc'),
                    limit(200)
                );
                const snap = await getDocs(q);
                setLogs(snap.docs.map(d => ({ id: d.id, ...d.data() })));
            } catch (err) {
                console.error("Failed to fetch logs:", err);
            } finally {
                setLoading(false);
            }
        };
        fetchLogs();
    }, [companyId, campaignId, isE2ECampaignMock]);

    const filteredLogs = logs.filter(log =>
        log.recipientName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        log.recipientIdentity?.includes(searchTerm)
    );

    if (loading) {
        return (
            <Card padding="lg" className="text-center">
                <p role="status" className="text-ds-sm font-medium text-ds-content-muted">
                    Loading detailed results...
                </p>
            </Card>
        );
    }

    if (logs.length === 0) {
        return (
            <Card padding="lg" className="text-center">
                <p role="status" className="text-ds-sm font-medium text-ds-content-muted">
                    No messages sent yet.
                </p>
            </Card>
        );
    }

    return (
        <Card padding="none" className="overflow-hidden">
            <div className="flex flex-col gap-ds-3 border-b border-ds-border-subtle bg-ds-surface-subtle p-ds-4 sm:flex-row sm:items-center sm:justify-between">
                <h3 className="text-ds-sm font-bold uppercase tracking-wide text-ds-content">Recipient Log</h3>
                <div className="flex items-center gap-ds-2">
                    <Search className="text-ds-content-muted" size={16} aria-hidden="true" />
                    <Label htmlFor={searchId} className="sr-only">Search recipients by name or contact</Label>
                    <Input
                        id={searchId}
                        type="search"
                        placeholder="Search name or phone..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full sm:w-56"
                    />
                </div>
            </div>

            <div
                role="region"
                aria-label="Recipient delivery log"
                tabIndex={0}
                className="custom-scrollbar max-h-[400px] overflow-auto focus-visible:outline-none focus-visible:shadow-ds-focus"
            >
                <table className="w-full min-w-[640px] border-collapse text-left">
                    <caption className="sr-only">Recipient delivery log</caption>
                    <thead className="sticky top-0 z-10 bg-ds-surface-subtle">
                        <tr>
                            <th scope="col" className="px-ds-6 py-ds-3 text-ds-xs font-bold uppercase tracking-wide text-ds-content-secondary">Recipient</th>
                            <th scope="col" className="px-ds-6 py-ds-3 text-ds-xs font-bold uppercase tracking-wide text-ds-content-secondary">Contact</th>
                            <th scope="col" className="px-ds-6 py-ds-3 text-ds-xs font-bold uppercase tracking-wide text-ds-content-secondary">Status</th>
                            <th scope="col" className="px-ds-6 py-ds-3 text-ds-xs font-bold uppercase tracking-wide text-ds-content-secondary">Time</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-ds-border-subtle">
                        {filteredLogs.length === 0 ? (
                            <tr>
                                <td colSpan={4} className="px-ds-6 py-ds-8 text-center text-ds-sm font-medium text-ds-content-muted">
                                    No recipients match your search.
                                </td>
                            </tr>
                        ) : (
                            filteredLogs.map(log => {
                                const delivered = log.status === 'delivered';
                                return (
                                    <tr key={log.id} className="transition-colors hover:bg-ds-surface-subtle">
                                        <th scope="row" className="px-ds-6 py-ds-3 text-left align-top">
                                            <span className="text-ds-sm font-bold text-ds-content">{log.recipientName || 'Unknown'}</span>
                                        </th>
                                        <td className="px-ds-6 py-ds-3 align-top">
                                            <span className="font-mono text-ds-xs text-ds-content-secondary">{log.recipientIdentity}</span>
                                        </td>
                                        <td className="px-ds-6 py-ds-3 align-top">
                                            <Badge tone={delivered ? 'success' : 'danger'} icon={delivered ? CheckCircle2 : AlertCircle}>
                                                {delivered ? 'Delivered' : 'Failed'}
                                            </Badge>
                                            {log.error && (
                                                <p className="mt-ds-1 text-ds-xs font-medium text-ds-status-danger-fg">{log.error}</p>
                                            )}
                                        </td>
                                        <td className="px-ds-6 py-ds-3 align-top">
                                            <span className="inline-flex items-center gap-ds-1 text-ds-xs font-medium text-ds-content-muted">
                                                <Clock size={12} aria-hidden="true" />
                                                {log.timestamp?.toDate ? log.timestamp.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Pending'}
                                            </span>
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>
        </Card>
    );
}
