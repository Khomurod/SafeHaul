// src/features/applications/components/SubmissionRecordNotice.jsx
//
// States what KIND of record the surrounding screen is showing.
//
// This exists because the dangerous failure mode is silent: a historical
// application rendered from live data looks exactly like a preserved original.
// A recruiter relying on it for an FMCSA or FCRA question would have no way to
// know the wording could have changed since. So every surface that shows a
// submission states its provenance, and this is the one component that says it.
//
// DESIGN-SYSTEM NOTE
// ------------------
// Composed from approved semantic `--ds-*` status tokens and spacing scale. It
// is deliberately NOT a new visual primitive: the tone/border/background triple
// matches the established callout pattern already used in features (see
// LaunchPad). Nothing here introduces an arbitrary colour or font size.

import React from 'react';
import { ShieldCheck, AlertTriangle, History } from 'lucide-react';

/**
 * Tone triples drawn straight from the approved status tokens.
 * `neutral` is used for the good case so a correct record stays quiet rather
 * than competing with real warnings for attention.
 */
const TONES = {
    neutral: {
        wrapper: 'border-ds-status-neutral-border bg-ds-status-neutral-bg',
        text: 'text-ds-status-neutral-fg',
    },
    warning: {
        wrapper: 'border-ds-status-warning-border bg-ds-status-warning-bg',
        text: 'text-ds-status-warning-fg',
    },
    info: {
        wrapper: 'border-ds-status-info-border bg-ds-status-info-bg',
        text: 'text-ds-status-info-fg',
    },
};

/** Readable submitted date; falls back to the raw value rather than inventing one. */
function formatSubmittedAt(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * @param {object} props
 * @param {object|null} props.record  Output of `presentSubmission`.
 * @param {string} [props.className]
 */
export function SubmissionRecordNotice({ record, className = '' }) {
    if (!record) return null;

    const submittedOn = formatSubmittedAt(record.submittedAt);

    let tone;
    let Icon;
    let heading;
    let body;

    if (!record.isPreserved) {
        tone = 'warning';
        Icon = AlertTriangle;
        heading = 'No preserved submission record';
        body = record.notice;
    } else if (record.isReconstructed) {
        tone = 'info';
        Icon = History;
        heading = 'Reconstructed record';
        body = record.notice;
    } else {
        tone = 'neutral';
        Icon = ShieldCheck;
        heading = 'Preserved original submission';
        body = submittedOn
            ? `Exactly as submitted on ${submittedOn}. Wording and answers are frozen.`
            : 'Exactly as submitted. Wording and answers are frozen.';
    }

    const { wrapper, text } = TONES[tone];
    const notes = Array.isArray(record.reconstructionNotes) ? record.reconstructionNotes : [];

    return (
        <div
            role="status"
            className={`flex items-start gap-ds-3 rounded-ds-lg border p-ds-4 ${wrapper} ${className}`}
        >
            <Icon size={18} aria-hidden="true" className={`${text} mt-px shrink-0`} />
            <div className={`text-ds-sm ${text}`}>
                <p className="font-semibold">{heading}</p>
                {body ? <p className="mt-ds-1">{body}</p> : null}
                {notes.length > 0 ? (
                    <ul className="mt-ds-2 list-disc space-y-ds-1 pl-ds-4">
                        {notes.map((note) => <li key={note}>{note}</li>)}
                    </ul>
                ) : null}
            </div>
        </div>
    );
}

export default SubmissionRecordNotice;
