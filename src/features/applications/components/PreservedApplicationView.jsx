// src/features/applications/components/PreservedApplicationView.jsx
//
// Renders a preserved submission record — the whole application, as submitted.
//
// WHY THIS EXISTS
// ---------------
// Every "full application" surface used to render from the live application
// document while a banner above it announced a preserved original. That is worse
// than having no banner: it tells a recruiter the record is frozen while showing
// them data a company edit can change underneath it. A recruiter answering an
// FMCSA or FCRA question from that screen has no way to know.
//
// This component renders the record itself. It takes the output of
// `presentSubmission` and nothing else — no application document, no company
// profile, no live settings — so there is no second source it could silently
// fall back to.
//
// DESIGN-SYSTEM NOTE
// ------------------
// Composed from the approved `Card`, `Badge` and `FieldDisplay` primitives and
// `--ds-*` tokens. It introduces no new visual primitive: the section/record
// treatment is the established card-with-header pattern the dossier already
// uses.

import React, { useState } from 'react';
import { Icon as DsIcon, FileText, ShieldCheck, ShieldOff, ShieldAlert } from '@design-system/icons';
import { Badge, Button, Card, FieldDisplay } from '@/design-system/components';
import { EmptyState } from '@/design-system/patterns';
import { useToast } from '@shared/components/feedback/ToastProvider';
import { signedApplicationFileUrl } from '../services/applicationFileLink';

/** A value the driver did not supply, said in words rather than left blank. */
const NOT_PROVIDED_TONE = 'italic text-ds-content-muted';

/** Readable instant; falls back to the raw value rather than inventing one. */
function formatInstant(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString(undefined, {
        year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
}

/**
 * Mask a Social Security Number to its last four digits.
 *
 * The record stores the number as truth; masking is a presentation decision, and
 * on screen the answer is always no. The full number appears only in the
 * authorized original PDF, whose every access is authorized and audited.
 */
function maskSensitive(value) {
    const digits = String(value ?? '').replace(/\D/g, '');
    if (!digits) return value;
    return `***-**-${digits.slice(-4)}`;
}

/**
 * Opens the file a driver uploaded for a custom question.
 *
 * A button rather than a link because it acts first: the link is minted when it
 * is pressed, since a signed URL lives minutes and this screen can stay open for
 * hours.
 *
 * The tab is opened inside the press itself and pointed at the file once the link
 * arrives. A browser that allows a new tab only during the click's own user
 * activation blocks one opened after an `await`, and a cold callable can take
 * seconds — the tab would silently never appear. `opener` is cleared at once,
 * which is what `noopener` would have done for a URL opened directly.
 */
function OpenUploadedFile({ storagePath }) {
    const { showError } = useToast();
    const [opening, setOpening] = useState(false);

    const open = async () => {
        const tab = window.open('', '_blank');
        if (!tab) {
            showError('Your browser blocked the new tab. Allow pop-ups for this site, then try again.');
            return;
        }
        tab.opener = null;
        setOpening(true);
        try {
            tab.location.href = await signedApplicationFileUrl(storagePath);
        } catch (error) {
            tab.close();
            showError(error?.code === 'functions/not-found'
                ? 'This file could not be found. It may have been deleted.'
                : 'Could not open this file. Please try again.');
        } finally {
            setOpening(false);
        }
    };

    return (
        <div className="mt-ds-2">
            <Button variant="secondary" size="sm" onClick={open} loading={opening}>
                <DsIcon icon={FileText} size="sm" />
                Open file<span className="ds-visually-hidden"> (opens in a new tab)</span>
            </Button>
        </div>
    );
}

function AnswerRow({ answer, openUploads }) {
    const value = answer.sensitive && !answer.isMissing ? maskSensitive(answer.value) : answer.value;
    const display = (
        <FieldDisplay label={answer.label} className="min-w-0">
            <span className={`whitespace-pre-wrap [overflow-wrap:anywhere] ${answer.isMissing ? NOT_PROVIDED_TONE : ''}`}>
                {value}
            </span>
        </FieldDisplay>
    );
    if (!openUploads || !answer.storagePath) return display;
    // Beside the value rather than inside it: `FieldDisplay` holds its value in a
    // `<p>`, which cannot contain the button's block.
    return (
        <div className="min-w-0">
            {display}
            <OpenUploadedFile storagePath={answer.storagePath} />
        </div>
    );
}

/**
 * One record of a repeating group.
 *
 * Cells come from the frozen column list, already resolved to label/value pairs,
 * so nothing here needs to know what an employer is — and a raw object can never
 * reach the page as `[object Object]`.
 */
function RecordRows({ answer }) {
    if (answer.rows.length === 0) {
        return <p className={`text-ds-sm ${NOT_PROVIDED_TONE}`}>None recorded.</p>;
    }
    return (
        <ul className="space-y-ds-3">
            {answer.rows.map((cells, index) => (
                <li
                    // Index is the only stable identity a frozen row has; the
                    // list is immutable, so it cannot reorder.
                    key={index}
                    className="rounded-ds-md border border-ds-border-subtle p-ds-3"
                >
                    <div className="grid grid-cols-1 gap-x-ds-6 gap-y-ds-2 sm:grid-cols-2">
                        {cells.map((cell) => (
                            <FieldDisplay key={cell.label} label={cell.label} className="min-w-0">
                                <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">{cell.displayValue}</span>
                            </FieldDisplay>
                        ))}
                    </div>
                </li>
            ))}
        </ul>
    );
}

function Section({ title, children }) {
    return (
        <Card padding="none" className="overflow-hidden">
            <div className="border-b border-ds-border-subtle bg-ds-surface-subtle px-ds-5 py-ds-3">
                <h4 className="text-ds-body font-bold text-ds-content">{title}</h4>
            </div>
            <div className="p-ds-5">{children}</div>
        </Card>
    );
}

/** The plain-language state of one agreement, with an icon that matches it. */
const AGREEMENT_PRESENTATION = {
    accepted: { Icon: ShieldCheck, tone: 'success' },
    declined: { Icon: ShieldOff, tone: 'danger' },
    unrecorded: { Icon: ShieldAlert, tone: 'warning' },
};

function AgreementRow({ agreement }) {
    const { Icon, tone } = AGREEMENT_PRESENTATION[agreement.status] || AGREEMENT_PRESENTATION.unrecorded;
    const acceptedAt = formatInstant(agreement.acceptedAt);

    return (
        <li className="rounded-ds-md border border-ds-border-subtle p-ds-3">
            <div className="flex flex-wrap items-center justify-between gap-ds-2">
                <p className="flex min-w-0 items-center gap-ds-2 text-ds-sm font-semibold text-ds-content">
                    {/* `Icon` here is a glyph out of the map above, so it is a
                        TOKEN and cannot be rendered as a component — `DsIcon`
                        opens it. Rendering it directly used to work and now
                        throws, which is the whole point of a token: the failure
                        is at the call site rather than a silently wrong size. */}
                    <DsIcon icon={Icon} className="shrink-0" />
                    <span className="min-w-0">{agreement.title}</span>
                </p>
                <Badge tone={tone}>{agreement.summary}</Badge>
            </div>
            <p className="mt-ds-1 text-ds-xs text-ds-content-secondary">
                Version {agreement.version}
                {acceptedAt ? ` · Accepted ${acceptedAt}` : ''}
                {/* Stated only where THIS agreement carries its own acceptance
                    evidence. The old PDF stamped one signature onto all four. */}
                {agreement.hasSignature ? ` · Signed electronically (${agreement.signatureType})` : ''}
                {agreement.legacyWording ? ' · Wording in force at the time' : ''}
            </p>
        </li>
    );
}

/**
 * @param {object} props
 * @param {object} props.record Output of `presentSubmission`.
 * @param {boolean} [props.openUploads=false] Also offer **Open file** beside a
 *   standard upload (a licence, a medical card). A custom question's file always
 *   has one; the dossier shows the standard documents elsewhere, and an
 *   unfinished application, which has no dossier, asks for this.
 */
export function PreservedApplicationView({ record, openUploads = false }) {
    if (!record || !record.isPreserved) {
        /*
         * A hand-composed `EmptyState` until 2026-09-06: a bordered box with
         * `role="status"`, a large decorative glyph, a bold line and a
         * supporting line. That is the pattern exactly, and roadmap §7 records
         * this shape as the drift no rule can see — every piece is an approved
         * primitive, so nothing complains.
         *
         * The 40px glyph is what surfaced it. It is not a step on the icon
         * scale, snapping it to 32 would have been a visible change made for no
         * reason, and the honest answer to "which container owns this size" is
         * the one that owns the whole block.
         *
         * The live region moves rather than doubling: `EmptyState` announces
         * politely and renders the `role="status"` itself, so the hand-written
         * one goes with the `div` that carried it. And the bold paragraph
         * becomes the state's heading, which puts an empty state's message in
         * the document outline where it belongs — `headingLevel={3}` because
         * this renders inside a tab under an `h2`.
         */
        return (
            <EmptyState
                icon={FileText}
                headingLevel={3}
                title="Nothing was preserved for this submission."
                description={record?.notice
                    || 'This application was submitted before submitted applications were archived.'}
            />
        );
    }

    return (
        <div className="space-y-ds-5">
            {record.sections.map((section) => (
                <Section key={section.id} title={section.title}>
                    <div className="grid grid-cols-1 gap-x-ds-8 gap-y-ds-4 md:grid-cols-2">
                        {section.answers.filter((answer) => !answer.repeating).map((answer) => (
                            <AnswerRow key={answer.key} answer={answer} openUploads={openUploads} />
                        ))}
                    </div>
                    {section.answers.filter((answer) => answer.repeating).map((answer) => (
                        <div key={answer.key} className="mt-ds-4 border-t border-ds-border-subtle pt-ds-4">
                            <h5 className="mb-ds-2 text-ds-sm font-semibold text-ds-content">{answer.label}</h5>
                            {answer.usedCurrentColumns && (
                                <p className={`mb-ds-2 text-ds-xs ${NOT_PROVIDED_TONE}`}>
                                    This record predates stored field names, so these entries are laid
                                    out under the application&rsquo;s current ones. The
                                    applicant&rsquo;s answers are unchanged.
                                </p>
                            )}
                            <RecordRows answer={answer} />
                        </div>
                    ))}
                </Section>
            ))}

            {record.coverage && (
                <Section title="Employment History Coverage">
                    <p className="text-ds-sm text-ds-content">{record.coverage.summary}</p>
                    {!record.coverage.isComplete && record.coverage.gaps.length > 0 && (
                        <ul className="mt-ds-2 list-disc space-y-ds-1 pl-ds-5 text-ds-sm text-ds-content-secondary">
                            {record.coverage.gaps.map((gap) => (
                                <li key={`${gap.fromMonth}-${gap.toMonth}`}>
                                    {gap.fromMonth} to {gap.toMonth}
                                    {typeof gap.months === 'number' ? ` (${gap.months} month${gap.months === 1 ? '' : 's'})` : ''}
                                </li>
                            ))}
                        </ul>
                    )}
                </Section>
            )}

            {record.customAnswers.length > 0 && (
                <Section title="Supplemental Questions">
                    <dl className="space-y-ds-4">
                        {record.customAnswers.map((answer) => (
                            <div key={answer.key}>
                                <dt className={`text-ds-sm font-semibold ${answer.labelUnavailable ? NOT_PROVIDED_TONE : 'text-ds-content'}`}>
                                    {answer.label}
                                </dt>
                                {answer.unmatched && (
                                    <p className={`text-ds-xs ${NOT_PROVIDED_TONE}`}>
                                        This answer no longer matches a question on the application. It is kept
                                        because the applicant gave it.
                                    </p>
                                )}
                                <dd className={`mt-ds-1 whitespace-pre-wrap text-ds-sm [overflow-wrap:anywhere] ${answer.isMissing ? NOT_PROVIDED_TONE : 'text-ds-content-secondary'}`}>
                                    {answer.value}
                                    {answer.storagePath && <OpenUploadedFile storagePath={answer.storagePath} />}
                                </dd>
                            </div>
                        ))}
                    </dl>
                </Section>
            )}

            {record.agreements.length > 0 && (
                <Section title="Legal Agreements">
                    <ul className="space-y-ds-2">
                        {record.agreements.map((agreement) => (
                            <AgreementRow key={agreement.key} agreement={agreement} />
                        ))}
                    </ul>
                </Section>
            )}
        </div>
    );
}

export default PreservedApplicationView;
