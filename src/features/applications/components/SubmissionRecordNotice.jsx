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
// This file used to carry its own tone map — three `border-*`/`bg-*`/`text-*`
// triples — and hand-build the block around them. The comment here said that was
// fine because the triples were approved `--ds-*` tokens, and that was true and
// beside the point: the colours were never the problem. The SHAPE was, and it
// was the shape `Notice` now owns.
//
// It survived Phase 6 for a mechanical reason worth recording. `hand-composed-
// notice` matches an element carrying both halves of the signature as literal
// classes; here the tint arrived through `TONES[tone]`, so the rule saw a `div`
// with a template string and nothing else. 6a counted that case separately and
// said a literal-class scanner cannot resolve a computed one. Phase 7 found it
// anyway, from the other end: the glyph was held in a local `let` and rendered
// directly, which throws the moment the name is a token.

import React from 'react';
import { ShieldCheck, AlertTriangle, History } from '@design-system/icons';
import { Notice } from '@/design-system/components';

/** Readable submitted date; falls back to the raw value rather than inventing one. */
function formatSubmittedAt(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * The three provenance states, each with the tone and glyph that says it.
 *
 * `neutral` for the good case so a correct record stays quiet rather than
 * competing with real warnings for attention — the reason the old tone map gave,
 * kept because it is still the right one.
 */
function presentation(record, submittedOn) {
    if (!record.isPreserved) {
        return {
            tone: 'warning',
            icon: AlertTriangle,
            title: 'No preserved submission record',
            body: record.notice,
        };
    }
    if (record.isReconstructed) {
        return {
            tone: 'info',
            icon: History,
            title: 'Reconstructed record',
            body: record.notice,
        };
    }
    return {
        tone: 'neutral',
        icon: ShieldCheck,
        title: 'Preserved original submission',
        body: submittedOn
            ? `Exactly as submitted on ${submittedOn}. Wording and answers are frozen.`
            : 'Exactly as submitted. Wording and answers are frozen.',
    };
}

/**
 * @param {object} props
 * @param {object|null} props.record  Output of `presentSubmission`.
 * @param {string} [props.className]
 */
export function SubmissionRecordNotice({ record, className = '' }) {
    if (!record) return null;

    const { tone, icon, title, body } = presentation(record, formatSubmittedAt(record.submittedAt));
    const notes = Array.isArray(record.reconstructionNotes) ? record.reconstructionNotes : [];

    return (
        /*
         * `announce="polite"` rather than an outer `role="status"`: the block IS
         * the live region, and it is rendered conditionally, so the role has to
         * be on the thing that appears. Wrapping it in a second one would
         * announce twice.
         */
        <Notice tone={tone} icon={icon} title={title} announce="polite" size="sm" className={className}>
            {body ? <p>{body}</p> : null}
            {notes.length > 0 ? (
                <ul className="mt-ds-2 list-disc space-y-ds-1 pl-ds-4">
                    {notes.map((note) => <li key={note}>{note}</li>)}
                </ul>
            ) : null}
        </Notice>
    );
}

export default SubmissionRecordNotice;
