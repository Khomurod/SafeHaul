import React, { useEffect, useId, useState, useMemo } from 'react';
import { collection, query, orderBy, getDocs } from 'firebase/firestore';
import { db } from '@lib/firebase';
import {
    CircleDot, User, FileText, RefreshCcw, MessageSquare,
    Mail, Phone, ShieldCheck, Filter, Calendar, Zap,
    Settings, CheckCircle2, XCircle
} from 'lucide-react';
import { Badge, Card, FormField, Select } from '@/design-system/components';

/**
 * Audit trail for one application or lead.
 *
 * Migrated to the design system 2026-07-28. This was one of the four dossier tab
 * bodies deliberately left unmigrated by the 2026-07-27 dossier foundation slice
 * and recorded as residual debt since.
 *
 * Presentation only. Frozen and unchanged: the `collectionName === 'leads' ?
 * 'leads' : 'applications'` normalisation, the
 * `companies/{companyId}/{collection}/{applicationId}/activity_logs` path and its
 * `orderBy('timestamp', 'desc')`, the five filter values and their exact matching
 * rules, the Today/Yesterday/date grouping including the `'Recent'` bucket for
 * logs with no timestamp, the `en-US` `{ month: 'short', day: 'numeric', year:
 * 'numeric' }` date format and the 2-digit time format, the domain→icon decision
 * table and its precedence order, the `'System Auto'` and `'Pending'` fallbacks,
 * the call-duration rule, and every user-facing string.
 *
 * Defects fixed:
 *  1. **Sub-12px functional text in five places** — `text-[10px]` on the date
 *     group headings, the outcome pill and the timestamp, and `text-[11px]` /
 *     `text-[9px]` on the performer line and its avatar.
 *  2. **The filter `<select>` had no accessible name** — a bare `<select>` next to
 *     a decorative funnel icon, so a screen reader announced an unnamed combobox
 *     with no indication of what it filtered.
 *  3. **`text-gray-400` on white = 2.56:1** on the group headings, the timestamps,
 *     the duration and the empty-state text; `opacity-20` on the empty-state icon
 *     took it lower still.
 *  4. **The loading state was an unannounced bare spinner.**
 *  5. **The timeline was an unnamed scroll region** with no focusable child, so
 *     keyboard users could not scroll it.
 *  6. **Ten independent icon hues** (`emerald`, `indigo`, `orange`, `purple`,
 *     `red-500`, `green`, `amber`, `yellow`, `blue`, `gray-400`) were chosen
 *     locally, none of them approved tokens and several failing contrast on white.
 *     The feature still owns which domain event maps to which meaning; it now maps
 *     to the design system's semantic tones instead of inventing colours.
 *  7. The outcome pill was a hand-built `bg-blue-50` chip; it is now a `Badge`.
 *  8. Hard-coded `rounded-xl`, `shadow-sm`/`shadow-md`, `border-gray-100`,
 *     `bg-gray-50/50` and a `scrollbar-thumb-gray-200` utility replaced by tokens.
 */

/**
 * Domain event → semantic tone class. The precedence order below is the original
 * decision table, unchanged; only the colour values are now approved tokens.
 */
const TONE = {
    success: 'text-ds-status-success-fg',
    info: 'text-ds-status-info-fg',
    accent: 'text-ds-status-accent-fg',
    warning: 'text-ds-status-warning-fg',
    danger: 'text-ds-status-danger-fg',
    neutral: 'text-ds-content-secondary',
};

const FILTERS = [
    { value: 'all', label: 'All Activities' },
    { value: 'calls', label: 'Calls' },
    { value: 'notes', label: 'Notes' },
    { value: 'status', label: 'Status Changes' },
    { value: 'documents', label: 'Documents' },
];

export function ActivityHistoryTab({ companyId, applicationId, collectionName }) {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filterType, setFilterType] = useState('all');
    const filterFieldId = useId();
    const timelineLabelId = useId();

    useEffect(() => {
        if (companyId && applicationId) fetchLogs();
    }, [companyId, applicationId, collectionName]);

    const fetchLogs = async () => {
        setLoading(true);
        try {
            const validCollection = (collectionName === 'leads') ? 'leads' : 'applications';
            const logsRef = collection(db, "companies", companyId, validCollection, applicationId, "activity_logs");
            const q = query(logsRef, orderBy("timestamp", "desc"));

            const snapshot = await getDocs(q);
            const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setLogs(data);
        } catch (error) {
            console.error("Error loading history:", error);
        } finally {
            setLoading(false);
        }
    };

    const getIcon = (type, action) => {
        const lowerAction = (action || '').toLowerCase();
        const lowerType = (type || '').toLowerCase();

        if (lowerType === 'call' || lowerAction.includes('call')) return <Phone size={16} className={TONE.success} />;
        if (lowerAction.includes('note')) return <MessageSquare size={16} className={TONE.neutral} />;
        if (lowerAction.includes('email')) return <Mail size={16} className={TONE.info} />;
        if (lowerAction.includes('assigned')) return <RefreshCcw size={16} className={TONE.warning} />;
        if (lowerAction.includes('status')) {
            if (lowerAction.includes('approved') || lowerAction.includes('hired')) return <CheckCircle2 size={16} className={TONE.accent} />;
            if (lowerAction.includes('rejected') || lowerAction.includes('disqualified')) return <XCircle size={16} className={TONE.danger} />;
            return <CircleDot size={16} className={TONE.info} />;
        }
        if (lowerType === 'upload' || lowerAction.includes('file') || lowerAction.includes('document')) return <FileText size={16} className={TONE.success} />;
        if (lowerAction.includes('pev') || lowerAction.includes('verification')) return <ShieldCheck size={16} className={TONE.warning} />;
        if (lowerAction.includes('converted')) return <Zap size={16} className={TONE.warning} />;
        if (lowerAction.includes('settings') || lowerAction.includes('updated')) return <Settings size={16} className={TONE.neutral} />;

        return <User size={16} className={TONE.neutral} />;
    };

    const filteredLogs = useMemo(() => {
        if (filterType === 'all') return logs;
        return logs.filter(log => {
            const action = (log.action || '').toLowerCase();
            const type = (log.type || '').toLowerCase();
            if (filterType === 'calls') return type === 'call' || action.includes('call');
            if (filterType === 'notes') return action.includes('note');
            if (filterType === 'status') return action.includes('status');
            if (filterType === 'documents') return type === 'upload' || action.includes('file') || action.includes('document');
            return true;
        });
    }, [logs, filterType]);

    const groupedLogs = useMemo(() => {
        const groups = {};
        filteredLogs.forEach(log => {
            if (!log.timestamp) {
                if (!groups['Recent']) groups['Recent'] = [];
                groups['Recent'].push(log);
                return;
            }
            const date = new Date(log.timestamp.seconds * 1000);
            const today = new Date();
            const yesterday = new Date();
            yesterday.setDate(today.getDate() - 1);

            let groupKey = '';
            if (date.toDateString() === today.toDateString()) groupKey = 'Today';
            else if (date.toDateString() === yesterday.toDateString()) groupKey = 'Yesterday';
            else groupKey = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

            if (!groups[groupKey]) groups[groupKey] = [];
            groups[groupKey].push(log);
        });
        return groups;
    }, [filteredLogs]);

    if (loading) {
        return (
            <p role="status" className="p-ds-10 text-center text-ds-sm text-ds-content-secondary">
                Loading activity history...
            </p>
        );
    }

    return (
        <Card padding="none" className="flex h-full flex-col overflow-hidden">
            {/* Filter Header */}
            <div className="flex flex-wrap items-center justify-between gap-ds-3 border-b border-ds-border-subtle bg-ds-surface-subtle p-ds-4">
                <div className="flex items-center gap-ds-2">
                    <Calendar size={18} className="text-ds-content-secondary" aria-hidden="true" />
                    <h3 id={timelineLabelId} className="text-ds-sm font-bold uppercase tracking-wider text-ds-content-secondary">
                        Audit Trail
                    </h3>
                </div>
                <div className="flex items-center gap-ds-2">
                    <Filter size={14} className="text-ds-content-secondary" aria-hidden="true" />
                    <FormField id={filterFieldId} label="Filter activities">
                        <Select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
                            {FILTERS.map(({ value, label }) => (
                                <option key={value} value={value}>{label}</option>
                            ))}
                        </Select>
                    </FormField>
                </div>
            </div>

            <div
                role="region"
                aria-labelledby={timelineLabelId}
                tabIndex={0}
                className="flex-1 overflow-y-auto p-ds-6 focus-visible:outline-none focus-visible:shadow-ds-focus"
            >
                {logs.length === 0 ? (
                    <div className="flex h-64 flex-col items-center justify-center rounded-ds-lg border-2 border-dashed border-ds-border-subtle text-ds-content-secondary">
                        <FileText size={32} className="mb-ds-2" aria-hidden="true" />
                        <p className="text-ds-sm">No activity recorded for this driver.</p>
                    </div>
                ) : filteredLogs.length === 0 ? (
                    <p role="status" className="p-ds-10 text-center text-ds-content-secondary">
                        No activities match the selected filter.
                    </p>
                ) : (
                    <div className="relative space-y-ds-8">
                        {/* Vertical Line */}
                        <div aria-hidden="true" className="absolute bottom-2 left-[15px] top-2 w-0.5 bg-ds-border-subtle"></div>

                        {Object.entries(groupedLogs).map(([group, groupLogs]) => (
                            <section key={group} className="space-y-ds-4">
                                <h4 className="mb-ds-2 flex items-center gap-ds-2 pl-8 text-ds-xs font-bold uppercase tracking-wider text-ds-content-secondary">
                                    <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-ds-border"></span>
                                    {group}
                                </h4>

                                {groupLogs.map((log) => (
                                    <article key={log.id} className="relative pl-10">
                                        {/* Icon Container */}
                                        <span
                                            aria-hidden="true"
                                            className="absolute left-0 top-0 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-ds-border-subtle bg-ds-surface shadow-ds-xs"
                                        >
                                            {getIcon(log.type, log.action)}
                                        </span>

                                        {/* Activity Content */}
                                        <Card padding="md" className="shadow-ds-xs">
                                            <div className="mb-ds-2 flex flex-wrap items-start justify-between gap-ds-2">
                                                <div className="flex flex-wrap items-center gap-ds-2">
                                                    <span className="text-ds-sm font-semibold text-ds-content">{log.action}</span>
                                                    {log.outcomeLabel && (
                                                        <Badge tone="info">{log.outcomeLabel}</Badge>
                                                    )}
                                                </div>
                                                <span className="font-mono text-ds-xs text-ds-content-secondary">
                                                    {log.timestamp ? new Date(log.timestamp.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Pending'}
                                                </span>
                                            </div>

                                            {log.details && (
                                                <p className="whitespace-pre-wrap break-words text-ds-sm font-medium leading-relaxed text-ds-content-secondary">
                                                    {log.details}
                                                </p>
                                            )}

                                            <div className="mt-ds-3 flex flex-wrap items-center justify-between gap-ds-2 border-t border-ds-border-subtle pt-ds-3">
                                                <div className="flex items-center gap-1.5 text-ds-xs font-semibold text-ds-content-secondary">
                                                    <span
                                                        aria-hidden="true"
                                                        className="flex h-5 w-5 items-center justify-center rounded-full bg-ds-status-accent-bg text-ds-xs text-ds-status-accent-fg"
                                                    >
                                                        {log.performedByName?.charAt(0) || 'S'}
                                                    </span>
                                                    {log.performedByName || 'System Auto'}
                                                </div>

                                                {(log.type === 'call' && log.duration) && (
                                                    <span className="text-ds-xs font-medium text-ds-content-secondary">Duration: {log.duration}s</span>
                                                )}
                                            </div>
                                        </Card>
                                    </article>
                                ))}
                            </section>
                        ))}
                    </div>
                )}
            </div>
        </Card>
    );
}
