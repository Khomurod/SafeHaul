import React, { useState } from 'react';
import {
    User,
    MapPin,
    Phone,
    Mail,
    CreditCard,
    Truck,
    AlertTriangle,
    CheckCircle,
    Eye,
    EyeOff,
    FileText,
    PenTool,
    Pencil,
    Link2,
} from 'lucide-react';
import { formatDate } from '@shared/utils/helpers';
import { formatIsoDateUs, formatMonthYearUs } from '@shared/utils/dateFormHelpers';
import { APPLICATION_SCHEMA } from '@/config/applicationSchema';
import { SchemaSection } from '@shared/components/schema/SchemaRenderer';
import { useApplicationChanges } from '@features/applications/hooks/useApplicationChanges';
import { Badge, Button, Card, IconButton } from '@/design-system/components';

/**
 * Dossier Application tab.
 *
 * The read-only summary (identity, license, safety, employment, consent), the
 * summary/full toggle and the pending-changes banner are migrated to the
 * approved `Card` / `Button` / `IconButton` / `Badge` / `FieldDisplay`
 * primitives and `--ds-*` tokens (2026-07-27).
 *
 * DELIBERATELY NOT MIGRATED in this campaign: the full-application
 * `SchemaSection` rendering/editing path and the propose-changes / review-link
 * workflow. Those are the complex-editing surface and are the next campaign;
 * only their trigger buttons are restyled here, with the callbacks untouched.
 *
 * Frozen contracts: the SSN masking rule, every `--` / `'A'` / `'Driver'`
 * fallback, the CDL expiry bands and their exact labels, the clean-record copy,
 * the legacy/current employer field aliases, the accepted-consent values
 * (`'agreed'` / `'yes'` / `true`), the data-url-only signature rendering, the
 * `'summary'` initial view, and the `previewValue` truncation rules.
 *
 * DEFECTS FIXED (2026-07-27):
 * - With no SSN on the application the mask was applied to the literal fallback
 *   string `'Unknown'`, so the card displayed **`***-**-nown`**. An absent SSN
 *   now renders the fully-masked `***-**-****`.
 * - The SSN reveal toggle was an icon-only `<button>` with no accessible name,
 *   so a screen-reader user was offered an unlabelled control that exposes a
 *   social security number. It is now a named `IconButton` whose label reflects
 *   its state.
 * - The summary/full toggle was two `<button>`s with no pressed state, so
 *   assistive technology could not tell which view was active — selection was
 *   carried by background colour alone.
 * - Card titles were `<h3>`; they now sit at `<h4>` beneath the header's `<h3>`.
 * - With no application data the tab rendered **nothing at all**, leaving the
 *   dossier's tab panel blank with no explanation. It now renders an announced
 *   empty state.
 * - Summary rows applied `truncate` to the value, so long addresses and names
 *   were clipped with no tooltip and no way to read them. Values now wrap.
 */

/** Compact value preview for the pending-changes before/after list. */
function previewValue(v) {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'object') return Array.isArray(v) ? `${v.length} item(s)` : '(updated)';
    const s = String(v);
    return s.length > 48 ? `${s.slice(0, 48)}…` : s;
}

/** Safely convert Firestore Timestamps, ISO strings, or epoch values to a Date (or null). */
function formatTimelineDate(val) {
    if (!val) return '??';
    const s = String(val).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return formatIsoDateUs(s);
    if (/^\d{4}-\d{2}$/.test(s)) return formatMonthYearUs(s);
    return formatDate(val);
}

function toDateOrNull(val) {
    if (!val) return null;
    if (typeof val?.toDate === 'function') return val.toDate();          // Firestore Timestamp
    if (typeof val === 'object' && val.seconds) return new Date(val.seconds * 1000); // {seconds, nanoseconds}
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
}

export function ApplicationTab({ appData, fileUrls = {}, canEdit = false, companyId, applicationId, collectionName = 'applications' }) {
    const [viewMode, setViewMode] = useState('summary'); // 'summary' | 'full'
    const [editing, setEditing] = useState(false);
    const [editedData, setEditedData] = useState({});

    const { pendingChanges, proposing, linking, proposeChanges, createReviewLink } =
        useApplicationChanges(companyId, applicationId, collectionName);

    // DEFECT FIX: this used to `return null`, so an application that resolved to
    // nothing left the dossier's tab panel completely blank — no explanation and
    // no indication that anything had happened. The panel now says so.
    if (!appData) {
        return (
            <div
                role="status"
                className="flex flex-col items-center justify-center py-ds-12 text-center text-ds-content-secondary"
            >
                <FileText size={48} className="mb-ds-4 text-ds-content-muted" aria-hidden="true" />
                <p className="font-medium text-ds-content">Application details are not available.</p>
                <p className="mt-ds-1 text-ds-sm">This record may have been removed, or you may not have access to it.</p>
            </div>
        );
    }

    const startEdit = () => {
        setEditedData({ ...appData });
        setEditing(true);
        setViewMode('full');
    };

    const handleFieldChange = (key, value) => {
        setEditedData((prev) => ({ ...prev, [key]: value }));
    };

    const handlePropose = async () => {
        const changes = Object.keys(editedData)
            .filter((k) => JSON.stringify(editedData[k]) !== JSON.stringify(appData[k]))
            .map((k) => ({ fieldKey: k, proposedValue: editedData[k] }));
        if (changes.length === 0) { setEditing(false); return; }
        const ok = await proposeChanges(changes);
        if (ok) setEditing(false);
    };

    return (
        <div className="space-y-ds-6">
            {/* Pending company edits — awaiting driver approval */}
            {pendingChanges.length > 0 && (
                <Card padding="md" className="border-ds-status-warning-border bg-ds-status-warning-bg">
                    <div className="mb-ds-2 flex flex-wrap items-center justify-between gap-ds-3">
                        <p className="flex items-center gap-ds-2 text-ds-sm font-semibold text-ds-status-warning-fg">
                            <AlertTriangle size={16} aria-hidden="true" />
                            {pendingChanges.length} field(s) edited by company — pending driver approval
                        </p>
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={createReviewLink}
                            disabled={linking}
                            loading={linking}
                        >
                            {linking ? null : <Link2 size={14} aria-hidden="true" />}
                            Copy driver review link
                        </Button>
                    </div>
                    <ul className="space-y-ds-1">
                        {pendingChanges.map((c) => (
                            <li key={c.id} className="flex flex-wrap items-center gap-ds-1 text-ds-xs text-ds-status-warning-fg">
                                <span className="font-semibold">{c.fieldLabel || c.fieldKey}:</span>
                                <span className="line-through">{previewValue(c.originalValue)}</span>
                                <span aria-hidden="true">→</span>
                                <span className="font-medium">{previewValue(c.proposedValue)}</span>
                                {c.status && c.status !== 'pending' && (
                                    <Badge tone="warning">{c.status}</Badge>
                                )}
                            </li>
                        ))}
                    </ul>
                </Card>
            )}

            {/* Edit controls */}
            {canEdit && (
                <div className="flex flex-wrap items-center gap-ds-2">
                    {!editing ? (
                        <Button variant="secondary" size="sm" onClick={startEdit}>
                            <Pencil size={14} aria-hidden="true" /> Edit application
                        </Button>
                    ) : (
                        <>
                            <Button
                                variant="primary"
                                size="sm"
                                onClick={handlePropose}
                                disabled={proposing}
                                loading={proposing}
                            >
                                Propose changes for approval
                            </Button>
                            <Button variant="secondary" size="sm" onClick={() => setEditing(false)}>
                                Cancel
                            </Button>
                            <span className="text-ds-xs text-ds-content-secondary">Edits become pending changes the driver must approve.</span>
                        </>
                    )}
                </div>
            )}

            {/* Toggle Header */}
            {/* Feature-owned toggle group. `aria-pressed` carries the selection so
                it is never signalled by background colour alone. The design system
                has no Segmented/ToggleGroup primitive yet (recorded in the
                roadmap). */}
            <div
                role="group"
                aria-label="Application view"
                className="flex w-fit items-center gap-ds-1 rounded-ds-md border border-ds-border-subtle bg-ds-surface-subtle p-ds-1"
            >
                <button
                    type="button"
                    aria-pressed={viewMode === 'summary'}
                    onClick={() => setViewMode('summary')}
                    className={`flex min-h-11 items-center gap-ds-2 rounded-ds-sm px-ds-4 text-ds-sm font-medium transition-colors focus-visible:outline-none focus-visible:shadow-ds-focus ${viewMode === 'summary'
                        ? 'border border-ds-border-subtle bg-ds-surface text-ds-content-link shadow-ds-xs'
                        : 'border border-transparent text-ds-content-secondary hover:text-ds-content'
                        }`}
                >
                    Summary View
                </button>
                <button
                    type="button"
                    aria-pressed={viewMode === 'full'}
                    onClick={() => setViewMode('full')}
                    className={`flex min-h-11 items-center gap-ds-2 rounded-ds-sm px-ds-4 text-ds-sm font-medium transition-colors focus-visible:outline-none focus-visible:shadow-ds-focus ${viewMode === 'full'
                        ? 'border border-ds-border-subtle bg-ds-surface text-ds-content-link shadow-ds-xs'
                        : 'border border-transparent text-ds-content-secondary hover:text-ds-content'
                        }`}
                >
                    <FileText size={14} aria-hidden="true" />
                    Full Application
                </button>
            </div>

            {viewMode === 'summary' ? (
                /* Summary View (Cards) */
                <div className="grid grid-cols-1 gap-ds-6 md:grid-cols-12 animate-in fade-in duration-300">

                    {/* 1. Identity Card (Col Span 6) */}
                    <div className="md:col-span-6">
                        <IdentityCard appData={appData} />
                    </div>

                    {/* 2. License Card (Col Span 6) */}
                    <div className="md:col-span-6">
                        <LicenseCard appData={appData} fileUrls={fileUrls} />
                    </div>

                    {/* 3. Stats / Summary (Col Span 12) */}
                    <div className="md:col-span-12">
                        <SafetyCard appData={appData} />
                    </div>

                    {/* 4. Experience Timeline (Col Span 12) */}
                    <div className="md:col-span-12">
                        <ExperienceTimeline appData={appData} />
                    </div>

                    {/* 5. Consent & Signature (Col Span 12) */}
                    <div className="md:col-span-12">
                        <ConsentCard appData={appData} />
                    </div>
                </div>
            ) : (
                /* Full Application View (Schema Renderer) */
                <Card padding="lg" className="animate-in fade-in duration-300">
                    <div className="mx-auto max-w-4xl space-y-ds-8">
                        {APPLICATION_SCHEMA.sections.map(section => (
                            <div key={section.id} className="border-b border-ds-border-subtle pb-ds-8 last:border-0 last:pb-0">
                                <h4 className="mb-ds-4 flex items-center gap-ds-2 text-ds-body-lg font-bold text-ds-content">
                                    {section.title}
                                </h4>
                                <SchemaSection
                                    sectionId={section.id}
                                    data={editing ? editedData : appData}
                                    mode="display"
                                    isEditing={editing}
                                    onChange={handleFieldChange}
                                    fileUrls={fileUrls}
                                />
                            </div>
                        ))}
                    </div>
                </Card>
            )}
        </div>
    );
}

// --- Sub-Components ---

function IdentityCard({ appData }) {
    const [showSSN, setShowSSN] = useState(false);
    // DEFECT FIX: the previous code did `appData.ssn || 'Unknown'` and then masked
    // whatever that produced, so an application with no SSN rendered the literal
    // string 'Unknown' masked down to `***-**-nown`. A missing SSN is now fully
    // masked and there is nothing to reveal.
    const rawSsn = String(appData.ssn || '').trim();
    const hasSsn = rawSsn.length > 4;
    const maskedSSN = hasSsn ? `***-**-${rawSsn.slice(-4)}` : '***-**-****';

    return (
        <DossierSummaryCard icon={User} title="Personal Information">
            <InfoRow
                label="Full Name"
                value={`${appData.firstName || ''} ${appData.middleName ? appData.middleName + ' ' : ''}${appData.lastName || ''}`}
            />
            <InfoRow
                label="Date of Birth"
                value={appData.dob ? formatDate(appData.dob) : '--'}
            />
            <InfoRow
                label="Address"
                value={[appData.street || appData.address, appData.city, appData.state, appData.zip].filter(Boolean).join(', ') || '--'}
            />
            <div className="flex items-center justify-between gap-ds-2 border-b border-ds-border-subtle py-ds-2 last:border-0">
                <span className="text-ds-xs font-semibold uppercase text-ds-content-secondary">SSN</span>
                <div className="flex items-center gap-ds-2">
                    <span className="font-mono text-ds-sm font-medium text-ds-content">
                        {showSSN && hasSsn ? rawSsn : maskedSSN}
                    </span>
                    {hasSsn && (
                        <IconButton
                            variant="ghost"
                            size="sm"
                            label={showSSN ? 'Hide SSN' : 'Show SSN'}
                            onClick={() => setShowSSN(!showSSN)}
                        >
                            {showSSN ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
                        </IconButton>
                    )}
                </div>
            </div>
        </DossierSummaryCard>
    );
}

/**
 * Shared shell for the read-only summary cards: approved `Card` plus the toned
 * icon disc and the card heading, so the five cards cannot drift apart.
 */
function DossierSummaryCard({ icon: Icon, title, tone = 'info', children }) {
    const toneClass = {
        info: 'bg-ds-status-info-bg text-ds-status-info-fg',
        accent: 'bg-ds-status-accent-bg text-ds-status-accent-fg',
        warning: 'bg-ds-status-warning-bg text-ds-status-warning-fg',
        neutral: 'bg-ds-status-neutral-bg text-ds-status-neutral-fg',
        success: 'bg-ds-status-success-bg text-ds-status-success-fg',
    }[tone];

    return (
        <Card padding="md" className="h-full">
            <div className="mb-ds-4 flex items-center gap-ds-2">
                <span className={`rounded-ds-md p-ds-2 ${toneClass}`}>
                    <Icon size={20} aria-hidden="true" />
                </span>
                <h4 className="font-bold text-ds-content">{title}</h4>
            </div>
            <div className="space-y-ds-4">{children}</div>
        </Card>
    );
}

function LicenseCard({ appData, fileUrls = {} }) {
    const rawExp = appData.cdlExpiration || appData.cdlExpirationDate;
    const expDate = toDateOrNull(rawExp);
    const today = new Date();
    const daysUntilExp = expDate ? Math.ceil((expDate - today) / (1000 * 60 * 60 * 24)) : null;

    // Text label plus tone — the band is never colour-only.
    let badge = null;
    if (daysUntilExp !== null) {
        if (daysUntilExp < 0) {
            badge = <Badge tone="danger">EXPIRED</Badge>;
        } else if (daysUntilExp < 30) {
            badge = <Badge tone="warning">EXPIRING SOON</Badge>;
        } else {
            badge = <Badge tone="success">VALID</Badge>;
        }
    }

    const cdlFrontUrl = fileUrls['cdl-front'] || appData?.['cdl-front']?.url;
    const cdlBackUrl = fileUrls['cdl-back'] || appData?.['cdl-back']?.url;

    return (
        <DossierSummaryCard icon={CreditCard} title="License Information" tone="accent">
            <InfoRow
                label="CDL Number"
                value={appData.cdlNumber || '--'}
            />
            <InfoRow
                label="State of Issue"
                value={appData.cdlState || '--'}
            />
            <div className="flex items-center justify-between gap-ds-2 border-b border-ds-border-subtle py-ds-2 last:border-0">
                <span className="text-ds-xs font-semibold uppercase text-ds-content-secondary">Class</span>
                <Badge tone="neutral">{appData.cdlClass || appData.cdlType || 'A'}</Badge>
            </div>
            <div className="flex items-center justify-between gap-ds-2 border-b border-ds-border-subtle py-ds-2 last:border-0">
                <span className="text-ds-xs font-semibold uppercase text-ds-content-secondary">Expiration</span>
                <div className="flex flex-wrap items-center justify-end gap-ds-2">
                    <span className="text-ds-sm font-medium text-ds-content">
                        {rawExp ? formatDate(rawExp) : '--'}
                    </span>
                    {badge}
                </div>
            </div>

            {/* CDL Photo Thumbnails */}
            {(cdlFrontUrl || cdlBackUrl) && (
                <div className="border-t border-ds-border-subtle pt-ds-3">
                    <span className="mb-ds-2 block text-ds-xs font-semibold uppercase text-ds-content-secondary">CDL Photos</span>
                    <div className="flex gap-ds-3">
                        {/*
                          DOCUMENTED EXCEPTION — styled `<a>` rather than an
                          approved control: opening the full-size photo is a
                          navigation, and there is no Link primitive yet. The
                          caption is real text under the image instead of the old
                          `text-[10px]` overlay burned onto it.
                        */}
                        {cdlFrontUrl && (
                            <a
                                href={cdlFrontUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="rounded-ds-md focus-visible:outline-none focus-visible:shadow-ds-focus"
                            >
                                <img
                                    src={cdlFrontUrl}
                                    alt="CDL Front"
                                    className="h-16 w-24 rounded-ds-md border border-ds-border object-cover transition-colors hover:border-ds-focus"
                                    onError={(e) => { e.target.style.display = 'none'; }}
                                />
                                <span className="mt-ds-1 block text-center text-ds-xs font-semibold text-ds-content-secondary">Front</span>
                            </a>
                        )}
                        {cdlBackUrl && (
                            <a
                                href={cdlBackUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="rounded-ds-md focus-visible:outline-none focus-visible:shadow-ds-focus"
                            >
                                <img
                                    src={cdlBackUrl}
                                    alt="CDL Back"
                                    className="h-16 w-24 rounded-ds-md border border-ds-border object-cover transition-colors hover:border-ds-focus"
                                    onError={(e) => { e.target.style.display = 'none'; }}
                                />
                                <span className="mt-ds-1 block text-center text-ds-xs font-semibold text-ds-content-secondary">Back</span>
                            </a>
                        )}
                    </div>
                </div>
            )}
        </DossierSummaryCard>
    );
}

function SafetyCard({ appData }) {
    const violations = appData.violations || [];
    const accidents = appData.accidents || [];
    const hasIncidents = violations.length > 0 || accidents.length > 0;

    if (!hasIncidents) {
        return (
            <Card padding="md" className="flex items-center gap-ds-4 border-ds-status-success-border bg-ds-status-success-bg">
                <span className="rounded-full bg-ds-surface p-ds-2 text-ds-status-success-fg">
                    <CheckCircle size={24} aria-hidden="true" />
                </span>
                <div className="min-w-0">
                    <h4 className="font-bold text-ds-status-success-fg">Clean Record</h4>
                    <p className="text-ds-sm text-ds-status-success-fg">No violations or accidents reported on this application.</p>
                </div>
            </Card>
        );
    }

    return (
        <DossierSummaryCard icon={AlertTriangle} title="Safety Record" tone="warning">
            <div className="grid grid-cols-1 gap-ds-4 md:grid-cols-2">
                {violations.length > 0 && (
                    <div className="space-y-ds-3">
                        <h5 className="border-b border-ds-border-subtle pb-ds-1 text-ds-xs font-bold uppercase text-ds-content-secondary">Violations ({violations.length})</h5>
                        <ul className="space-y-ds-3">
                            {violations.map((v, i) => (
                                <li key={i} className="flex flex-col text-ds-sm">
                                    <span className="font-semibold text-ds-content">{v.charge || v.type || v.description || 'Violation'}</span>
                                    <span className="text-ds-xs text-ds-content-secondary">{v.date ? formatDate(v.date) : 'No Date'}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
                {accidents.length > 0 && (
                    <div className="space-y-ds-3">
                        <h5 className="border-b border-ds-border-subtle pb-ds-1 text-ds-xs font-bold uppercase text-ds-content-secondary">Accidents ({accidents.length})</h5>
                        <ul className="space-y-ds-3">
                            {accidents.map((a, i) => (
                                <li key={i} className="flex flex-col text-ds-sm">
                                    <span className="font-semibold text-ds-content">{a.details || a.type || a.description || 'Accident'}</span>
                                    <span className="text-ds-xs text-ds-content-secondary">{a.date ? formatDate(a.date) : 'No Date'}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>
        </DossierSummaryCard>
    );
}

function ExperienceTimeline({ appData }) {
    const history = appData.employers || appData.employmentHistory || [];

    if (history.length === 0) return null;

    return (
        <Card padding="md">
            <div className="mb-ds-6 flex items-center gap-ds-2">
                <span className="rounded-ds-md bg-ds-status-neutral-bg p-ds-2 text-ds-status-neutral-fg">
                    <Truck size={20} aria-hidden="true" />
                </span>
                <h4 className="font-bold text-ds-content">Employment History</h4>
                <Badge tone="neutral">{history.length}</Badge>
            </div>

            {/* A real list, so assistive technology announces how many jobs there are. */}
            <ol className="relative space-y-ds-8 border-l-2 border-ds-border-subtle pl-ds-4">
                {history.map((job, idx) => {
                    // Support both old (name/street/reason) and new (companyName/address/reasonForLeaving) field names
                    const employerName = job.companyName || job.name || 'Unknown Employer';
                    const employerAddress = job.address || job.street || '';
                    const reason = job.reasonForLeaving || job.reason || '';

                    return (
                        <li key={idx} className="relative">
                            <span
                                aria-hidden="true"
                                className="absolute -left-[21px] top-1 h-3 w-3 rounded-full bg-ds-action-primary ring-4 ring-ds-surface"
                            />

                            <div className="flex flex-col gap-ds-1 sm:flex-row sm:items-start sm:justify-between">
                                <div className="min-w-0">
                                    <h5 className="font-bold text-ds-content">{employerName}</h5>
                                    <p className="text-ds-sm text-ds-content-secondary">{job.position || 'Driver'}</p>
                                </div>
                                <p className="shrink-0 rounded-ds-sm bg-ds-surface-subtle px-ds-2 py-ds-1 text-ds-sm font-medium text-ds-content-secondary">
                                    {formatTimelineDate(job.startDate)} – {job.endDate ? formatTimelineDate(job.endDate) : 'Present'}
                                </p>
                            </div>

                            {/* Details Grid */}
                            <div className="mt-ds-2 grid grid-cols-1 gap-x-ds-6 gap-y-ds-1 text-ds-sm sm:grid-cols-2">
                                {(employerAddress || job.city || job.state) && (
                                    <p className="flex items-center gap-ds-1 text-ds-content-secondary">
                                        <MapPin size={12} className="shrink-0 text-ds-content-muted" aria-hidden="true" />
                                        <span>{[employerAddress, job.city, job.state].filter(Boolean).join(', ')}</span>
                                    </p>
                                )}
                                {job.phone && (
                                    <p className="flex items-center gap-ds-1 text-ds-content-secondary">
                                        <Phone size={12} className="shrink-0 text-ds-content-muted" aria-hidden="true" />
                                        <span>{job.phone}</span>
                                    </p>
                                )}
                                {job.companyEmail && (
                                    <p className="flex items-center gap-ds-1 text-ds-content-secondary">
                                        <Mail size={12} className="shrink-0 text-ds-content-muted" aria-hidden="true" />
                                        <span className="[overflow-wrap:anywhere]">{job.companyEmail}</span>
                                    </p>
                                )}
                                {job.supervisorName && (
                                    <p className="flex items-center gap-ds-1 text-ds-content-secondary">
                                        <User size={12} className="shrink-0 text-ds-content-muted" aria-hidden="true" />
                                        <span>Supervisor: {job.supervisorName}</span>
                                    </p>
                                )}
                                {job.supervisorPhone && (
                                    <p className="flex items-center gap-ds-1 text-ds-content-secondary">
                                        <Phone size={12} className="shrink-0 text-ds-content-muted" aria-hidden="true" />
                                        <span>{job.supervisorPhone}</span>
                                    </p>
                                )}
                                {job.supervisorEmail && (
                                    <p className="flex items-center gap-ds-1 text-ds-content-secondary">
                                        <Mail size={12} className="shrink-0 text-ds-content-muted" aria-hidden="true" />
                                        <span className="[overflow-wrap:anywhere]">{job.supervisorEmail}</span>
                                    </p>
                                )}
                                {job.mayContact && (
                                    <p className="flex items-center gap-ds-1">
                                        <Badge tone={job.mayContact === 'yes' ? 'success' : 'danger'}>
                                            {job.mayContact === 'yes' ? 'OK to Contact' : 'Do Not Contact'}
                                        </Badge>
                                    </p>
                                )}
                            </div>

                            {reason && (
                                <p className="mt-ds-2 text-ds-sm italic text-ds-content-secondary">&quot;Reason: {reason}&quot;</p>
                            )}
                        </li>
                    );
                })}
            </ol>
        </Card>
    );
}

function InfoRow({ label, value }) {
    return (
        <div className="flex items-center justify-between gap-ds-2 border-b border-ds-border-subtle py-ds-2 last:border-0">
            <span className="text-ds-xs font-semibold uppercase text-ds-content-secondary">
                {label}
            </span>
            {/*
              DEFECT FIX: this was `truncate`, so a full address or a long name
              was silently clipped to 60% of the row with no tooltip and no way
              to read the rest — worst at 412 px, where the value is the whole
              point of the row. It now wraps instead of hiding.
            */}
            <span className="max-w-[60%] text-right text-ds-sm font-medium text-ds-content [overflow-wrap:anywhere]">
                {value}
            </span>
        </div>
    );
}

function ConsentCard({ appData }) {
    const signature = appData.signature;
    const signatureDate = appData.signatureDate || appData['signature-date'];
    const agreements = [
        { key: 'agree-electronic', label: 'Electronic Transaction Consent' },
        { key: 'agree-background-check', label: 'Background Check Authorization' },
        { key: 'agree-psp', label: 'FMCSA PSP Authorization' },
        { key: 'final-certification', label: 'Final Certification' },
    ];

    const hasAnyConsent = signature || agreements.some(a => appData[a.key]);
    if (!hasAnyConsent) return null;

    return (
        <DossierSummaryCard icon={PenTool} title="Consent &amp; Signature" tone="success">
            <div className="grid grid-cols-1 gap-ds-6 md:grid-cols-2">
                {/* Agreements */}
                <div className="space-y-ds-2">
                    <h5 className="block text-ds-xs font-bold uppercase text-ds-content-secondary">Agreements</h5>
                    <ul className="space-y-ds-2">
                        {agreements.map(a => {
                            const isAccepted = appData[a.key] === 'agreed' || appData[a.key] === 'yes' || appData[a.key] === true;
                            return (
                                <li key={a.key} className="flex items-center gap-ds-2 text-ds-sm">
                                    {/* Icon + text; the accepted/declined state is also
                                        announced, never carried by colour alone. */}
                                    {isAccepted ? (
                                        <CheckCircle size={14} className="shrink-0 text-ds-status-success-fg" aria-hidden="true" />
                                    ) : (
                                        <span aria-hidden="true" className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-ds-border" />
                                    )}
                                    <span className={isAccepted ? 'text-ds-content' : 'text-ds-content-secondary'}>
                                        {a.label}
                                    </span>
                                    <span className="ds-visually-hidden">{isAccepted ? '— accepted' : '— not accepted'}</span>
                                </li>
                            );
                        })}
                    </ul>
                    {signatureDate && (
                        <p className="mt-ds-2 border-t border-ds-border-subtle pt-ds-2 text-ds-xs text-ds-content-secondary">
                            Signed on: <span className="font-medium text-ds-content">{formatDate(signatureDate)}</span>
                        </p>
                    )}
                </div>

                {/* Signature Image */}
                {signature && signature.startsWith('data:') && (
                    <div>
                        <h5 className="mb-ds-2 block text-ds-xs font-bold uppercase text-ds-content-secondary">Electronic Signature</h5>
                        <div className="inline-block rounded-ds-md border border-ds-border-subtle bg-ds-surface-subtle p-ds-3">
                            <img
                                src={signature}
                                alt="Driver Signature"
                                className="max-h-20 w-auto"
                            />
                        </div>
                    </div>
                )}
            </div>
        </DossierSummaryCard>
    );
}
