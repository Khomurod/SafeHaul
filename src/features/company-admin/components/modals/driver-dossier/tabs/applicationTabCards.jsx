/**
 * The Application tab's cards: identity (with the SSN masking rule), license
 * (with the CDL expiry bands), safety, the experience timeline, consent (with
 * the accepted-consent values and the data-url-only signature rendering), and
 * the shared summary-card and row primitives they compose. Extracted verbatim
 * from `ApplicationTab.jsx`, whose header records the frozen contracts these
 * cards carry; the tab keeps the view toggle, the pending-changes banner and
 * the full-application path.
 */

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
    PenTool,
} from 'lucide-react';
import { formatDate } from '@shared/utils/helpers';
import { formatIsoDateUs, formatMonthYearUs } from '@shared/utils/dateFormHelpers';
import { Badge, Card, IconButton, Link } from '@/design-system/components';

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
                          navigation, so it is a `Link` — with `tone="bare"`,
                          because there is no text to underline, and `external`,
                          which is what announces the new tab it opens. The
                          caption is real text under the image instead of the old
                          `text-[10px]` overlay burned onto it.
                        */}
                        {cdlFrontUrl && (
                            <Link
                                href={cdlFrontUrl}
                                external
                                tone="bare"
                                className="focus-visible:shadow-ds-focus"
                            >
                                <img
                                    src={cdlFrontUrl}
                                    alt="CDL Front"
                                    className="h-16 w-24 rounded-ds-md border border-ds-border object-cover transition-colors hover:border-ds-focus"
                                    onError={(e) => { e.target.style.display = 'none'; }}
                                />
                                <span className="mt-ds-1 block text-center text-ds-xs font-semibold text-ds-content-secondary">Front</span>
                            </Link>
                        )}
                        {cdlBackUrl && (
                            <Link
                                href={cdlBackUrl}
                                external
                                tone="bare"
                                className="focus-visible:shadow-ds-focus"
                            >
                                <img
                                    src={cdlBackUrl}
                                    alt="CDL Back"
                                    className="h-16 w-24 rounded-ds-md border border-ds-border object-cover transition-colors hover:border-ds-focus"
                                    onError={(e) => { e.target.style.display = 'none'; }}
                                />
                                <span className="mt-ds-1 block text-center text-ds-xs font-semibold text-ds-content-secondary">Back</span>
                            </Link>
                        )}
                    </div>
                </div>
            )}
        </DossierSummaryCard>
    );
}

/**
 * "yes" / "no" as the applicant answered it, or null for a record written before
 * the Yes/No questions existed (2026-09-02) — those are described by their lists.
 */
function yesNoAnswer(value) {
    const raw = String(value ?? '').trim().toLowerCase();
    return raw === 'yes' || raw === 'no' ? raw : null;
}

function SafetyCard({ appData }) {
    const violations = appData.violations || [];
    const accidents = appData.accidents || [];
    const hasIncidents = violations.length > 0 || accidents.length > 0;
    const violationsAnswer = yesNoAnswer(appData['has-violations']);
    const accidentsAnswer = yesNoAnswer(appData['has-accidents']);
    // A Yes with nothing listed is worth a recruiter's attention; say so rather
    // than calling the record clean.
    const declaredWithoutDetail = (violationsAnswer === 'yes' && violations.length === 0)
        || (accidentsAnswer === 'yes' && accidents.length === 0);

    if (!hasIncidents && !declaredWithoutDetail) {
        const explicit = violationsAnswer === 'no' && accidentsAnswer === 'no';
        return (
            <Card padding="md" className="flex items-center gap-ds-4 border-ds-status-success-border bg-ds-status-success-bg">
                <span className="rounded-ds-full bg-ds-surface p-ds-2 text-ds-status-success-fg">
                    <CheckCircle size={24} aria-hidden="true" />
                </span>
                <div className="min-w-0">
                    <h4 className="font-bold text-ds-status-success-fg">Clean Record</h4>
                    <p className="text-ds-sm text-ds-status-success-fg">
                        {explicit
                            ? 'The applicant answered No to moving violations and No to accidents in the past 3 years.'
                            : 'No violations or accidents reported on this application.'}
                    </p>
                </div>
            </Card>
        );
    }

    return (
        <DossierSummaryCard icon={AlertTriangle} title="Safety Record" tone="warning">
            {(violationsAnswer || accidentsAnswer) && (
                <p className="mb-ds-3 text-ds-sm text-ds-content-secondary" data-testid="safety-answers">
                    Moving violations (past 3 years): <strong className="text-ds-content">{violationsAnswer ? (violationsAnswer === 'yes' ? 'Yes' : 'No') : 'Not asked'}</strong>
                    {' · '}Accidents (past 3 years): <strong className="text-ds-content">{accidentsAnswer ? (accidentsAnswer === 'yes' ? 'Yes' : 'No') : 'Not asked'}</strong>
                </p>
            )}
            {declaredWithoutDetail && (
                <p className="mb-ds-3 text-ds-sm text-ds-status-warning-fg" role="note">
                    The applicant answered Yes but listed no details.
                </p>
            )}
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
                                className="absolute -left-[21px] top-1 h-3 w-3 rounded-ds-full bg-ds-action-primary ring-4 ring-ds-surface"
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
        // Applications submitted before the Clearinghouse consent was added to the
        // consent step legitimately have no value here, and correctly show as not
        // recorded rather than as refused.
        { key: 'agree-clearinghouse', label: 'FMCSA Clearinghouse Query Consent' },
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
                                        <span aria-hidden="true" className="h-3.5 w-3.5 shrink-0 rounded-ds-full border-2 border-ds-border" />
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

export {
    IdentityCard,
    DossierSummaryCard,
    LicenseCard,
    SafetyCard,
    ExperienceTimeline,
    InfoRow,
    ConsentCard,
};
