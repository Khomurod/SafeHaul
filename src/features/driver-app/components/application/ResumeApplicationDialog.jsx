import React, { useState } from 'react';

import { ConfirmDialog } from '@design-system/patterns';

/**
 * "Continue your existing application?" — in two stages, deliberately.
 *
 * Shown to a returning applicant whose identity and one of their contact details
 * matched an unfinished application at this carrier.
 *
 * ## Why starting over needs its own dialog
 *
 * `ConfirmDialog` routes Escape to `onCancel`. If "Start a new application" were
 * the cancel action, a stray Escape — or a keyboard user tabbing out of a dialog
 * they did not expect — would permanently delete the work they came back for.
 * That is precisely the outcome this feature exists to prevent, so discarding is
 * never a dismissal: it is its own explicit, destructive confirmation, and
 * Escape at either stage deletes nothing.
 *
 * ## What it deliberately does not say
 *
 * Nothing about the application beyond when it was started. No name, no email,
 * no field values: the applicant has been *recognised*, and the matching bar —
 * a name, a date of birth, a Social Security Number and a contact detail already
 * on the record — is a bar rather than a proof of identity. Whatever this dialog
 * says is said to whoever cleared it, so it says as little as it can while still
 * being a question someone can answer.
 *
 * `window.confirm` is not an option here even if it were tolerable UX: the lint
 * step refuses a native dialog (ESLint `no-alert`).
 */
export function ResumeApplicationDialog({ prompt, loading, error, onContinue, onStartOver }) {
    // The prompt the confirmation was opened for. The dialog stays mounted between
    // prompts, so a plain flag would open the next prompt on "Delete it and start
    // over" instead of on the question.
    const [confirmingFor, setConfirmingFor] = useState(null);

    if (!prompt) return null;
    const confirmingStartOver = confirmingFor === prompt;

    const started = prompt.startedAt ? new Date(prompt.startedAt) : null;
    const when = started && !Number.isNaN(started.getTime())
        ? started.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })
        : null;

    if (confirmingStartOver) {
        return (
            <ConfirmDialog
                title="Start a new application?"
                description="Your saved answers will be permanently deleted and you will begin again from the first page. This cannot be undone."
                tone="danger"
                confirmLabel="Delete it and start over"
                cancelLabel="Keep my saved application"
                loading={loading}
                error={error}
                onConfirm={onStartOver}
                // Back to the choice, not on to a deletion.
                onCancel={() => setConfirmingFor(null)}
            />
        );
    }

    return (
        <ConfirmDialog
            title="Continue your existing application?"
            description={when
                ? `You started an application with this carrier on ${when}. You can pick up where you left off, or start a new one.`
                : 'You have already started an application with this carrier. You can pick up where you left off, or start a new one.'}
            tone="info"
            confirmLabel="Continue where I left off"
            cancelLabel="Start a new application"
            loading={loading}
            error={error}
            onConfirm={onContinue}
            // Escape lands here too, and it must not delete anything — so this
            // opens the confirmation rather than performing the discard.
            onCancel={() => setConfirmingFor(prompt)}
        />
    );
}

export default ResumeApplicationDialog;
